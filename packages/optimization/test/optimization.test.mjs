import assert from 'node:assert/strict';
import test from 'node:test';
import { openLocalDatabase } from '@agent-workbench/local-database';
import { assertClassificationOutput, createInMemoryOptimizationStore, createSqliteOptimizationStore, emptyMetrics, issueFrom } from '../dist/index.js';

for (const adapter of [
  ['memory', () => ({ store:createInMemoryOptimizationStore(), close(){} })],
  ['sqlite', () => { const database=openLocalDatabase({filePath:':memory:'}); return {store:createSqliteOptimizationStore({database}),database,close:()=>database.close()}; }],
]) test(`${adapter[0]} store aggregates, reclassifies and merges issue history`, async()=>{
  const context=adapter[1]();
  try {
    const first=assignment('daily-1','batch-1','2026-08-24','group-a','fingerprint:a');
    const second=assignment('daily-2','batch-2','2026-08-25','group-b','fingerprint:b');
    first.issueId='issue-1'; second.issueId='issue-2';
    const firstIssue=issueFrom(first,'issue-1'); const secondIssue=issueFrom(second,'issue-2');
    await context.store.recordBatch({run:run('run-1','batch-1'),assignments:[first],newIssues:[firstIssue]});
    await context.store.recordBatch({run:run('run-2','batch-2'),assignments:[second],newIssues:[secondIssue]});
    await context.store.mergeIssues('project-1','issue-2','issue-1');
    let issue=await context.store.getIssue('project-1','issue-1');
    assert.equal(issue.metrics.episodeCount,2); assert.equal(issue.metrics.activeDayCount,2); assert.equal(issue.metrics.judgementCount,2);
    assert.equal(issue.metrics.totalTokens,30); assert.deepEqual(issue.fingerprints,['fingerprint:a','fingerprint:b']);
    await context.store.reassignDailyIssue('project-1','daily-2');
    issue=await context.store.getIssue('project-1','issue-1'); assert.equal(issue.metrics.episodeCount,1);
    assert.equal((await context.store.listIssues('project-1')).length,2);
    if(context.database) assert.equal(context.database.prepare('SELECT COUNT(*) AS count FROM optimization_reclassifications').get().count,2);
  } finally { context.close(); }
});

test('sqlite store preserves failed classification attempts for audit and retries only unfinished batches',async()=>{
  const database=openLocalDatabase({filePath:':memory:'}); const store=createSqliteOptimizationStore({database});
  try {
    await store.recordBatch({run:{...run('run-1','batch-1'),status:'failed',failureReason:'offline'},assignments:[],newIssues:[]});
    await store.recordBatch({run:{...run('run-2','batch-1'),status:'failed',failureReason:'still offline'},assignments:[],newIssues:[]});
    assert.equal(await store.hasProcessedBatch('batch-1'),false);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM optimization_classification_runs WHERE batch_id='batch-1'").get().count,2);
  } finally { database.close(); }
});

test('classification output covers every source and rejects invented issue ids',()=>{
  const sources=[assignment('daily-1','batch-1','2026-08-24','group-a','fingerprint:a').source];
  const issues=[issueFrom(assignment('old','old-batch','2026-08-23','old','fingerprint:old'),'issue-1')];
  const valid={decisions:[{dailyIssueId:'daily-1',targetType:'existing',targetId:'issue-1',confidence:.9,rationale:'Same root cause.',signals:[{key:'token_waste',label:'Token waste',level:'medium',confidence:.8,rationale:'Repeated failed work.',sourceJudgementIds:['judgement-daily-1']}]}]};
  assert.equal(assertClassificationOutput(valid,sources,issues)[0].signals[0].key,'token_waste');
  assert.throws(()=>assertClassificationOutput({decisions:[{...valid.decisions[0],targetId:'invented'}]},sources,issues),/unavailable/);
});

function assignment(id,batchId,date,groupKey,fingerprint){
  const source={dailyIssueId:id,batchId,projectId:'project-1',localDate:date,fingerprint,category:'repeated_failure',title:`Issue ${id}`,summary:'Repeated failure.',severity:'medium',impact:'Time lost.',recommendation:'Fix it.',judgements:[{judgementId:`judgement-${id}`,title:'Failure',summary:'Failure.',impact:'Time.',recommendation:'Fix.',evidence:[{evidenceId:`evidence-${id}`,description:'Observed.'}]}],episodes:[{episodeKey:`${date}:${groupKey}`,groupKey,localDate:date,turns:[{sessionId:'session-1',turnId:`turn-${id}`}],metrics:{turnCount:1,inputTokens:10,outputTokens:5,totalTokens:15,durationMs:100,toolCallCount:2,failedToolCallCount:1,repeatedToolCallCount:1,metricsComplete:true}}]};
  return {dailyIssueId:id,issueId:`issue-${id}`,source,status:'classified',confidence:.9,rationale:'Matched.',signals:[],assignedAt:`${date}T12:00:00.000Z`};
}
function run(runId,batchId){return {runId,projectId:'project-1',batchId,status:'completed',provider:'test',model:'test',startedAt:'2026-08-25T12:00:00.000Z',completedAt:'2026-08-25T12:00:01.000Z'};}
