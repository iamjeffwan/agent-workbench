import assert from 'node:assert/strict';
import test from 'node:test';
import { createInMemoryOptimizationStore } from '@agent-workbench/optimization';
import { createOptimizationWorkflowService } from '../electron/optimization-workflow-service.mjs';

test('backfills completed daily reviews in order and classifies idempotently',async()=>{
  const store=createInMemoryOptimizationStore(); const calls=[];
  const records=[daily('batch-2','2026-08-25','daily-2','judgement-2'),daily('batch-1','2026-08-24','daily-1','judgement-1')];
  const cases={case1:reviewCase(['judgement-1','judgement-2'])};
  const service=createOptimizationWorkflowService({
    reviewWorkflow:{listCompletedDailyReviews:async()=>ready({records,cases})},
    projectObservation:{read:()=>ready({projectId:'project-1'})}, sessionHistory:{resolveSessionFiles:async()=>ready({sessionFiles:['session']})},
    getUserDataPath:()=>'.',openDatabase:async()=>({close(){}}),createStore:()=>store,readFile:async()=>'',
    adaptSession:()=>({session:{sessionId:'session-1',turns:[turn('turn-1')]}}),createId:sequence(),now:()=>new Date('2026-08-26T00:00:00.000Z'),
    createAdapter:()=>({descriptor:{provider:'test',model:'classifier'},review:async request=>{const sources=request.evidencePackage.optimizationClassification.sources;const existing=request.evidencePackage.optimizationClassification.existing;calls.push(sources[0].localDate);return {output:{decisions:sources.map(source=>({dailyIssueId:source.dailyIssueId,targetType:existing.length?'existing':'new',targetId:existing[0]?.issueId??'same-root',confidence:.95,rationale:'Same root cause.',signals:[]}))}};}}),
  });
  const result=await service.processProject('C:\\project'); assert.equal(result.status,'ready'); assert.deepEqual(calls,['2026-08-24','2026-08-25']);
  assert.equal((await service.list('C:\\project')).data[0].metrics.activeDayCount,2);
  await service.processProject('C:\\project'); assert.equal(calls.length,2);
  await service.retry('C:\\project'); assert.equal(calls.length,2);
});

test('classification failure keeps exact-fingerprint data pending for retry',async()=>{
  const store=createInMemoryOptimizationStore(); const record=daily('batch-1','2026-08-24','daily-1','judgement-1');
  const service=createOptimizationWorkflowService({reviewWorkflow:{listCompletedDailyReviews:async()=>ready({records:[record],cases:{case1:reviewCase(['judgement-1'])}})},projectObservation:{read:()=>ready({projectId:'project-1'})},sessionHistory:{resolveSessionFiles:async()=>ready({sessionFiles:[]})},getUserDataPath:()=>'.',openDatabase:async()=>({close(){}}),createStore:()=>store,createAdapter:()=>({descriptor:{provider:'test',model:'classifier'},review:async()=>{throw new Error('offline');}}),createId:sequence()});
  await service.processProject('C:\\project'); const issues=(await service.list('C:\\project')).data; assert.equal(issues[0].classificationStatus,'pending_retry');
});

test('keeps equal fingerprints together and combines split chunks into one complete task event',async()=>{
  const store=createInMemoryOptimizationStore(); const record=daily('batch-1','2026-08-24','daily-1','judgement-1');
  record.chunks=[
    {...record.chunks[0],chunkId:'chunk-1',reviewCaseId:'case1',turns:[{sessionId:'session-1',turnId:'turn-1'}]},
    {...record.chunks[0],chunkId:'chunk-2',reviewCaseId:'case2',turns:[{sessionId:'session-1',turnId:'turn-2'}]},
  ];
  record.issues=[record.issues[0],{...record.issues[0],issueId:'daily-2',sourceJudgementIds:['judgement-2']}];
  const service=createOptimizationWorkflowService({reviewWorkflow:{listCompletedDailyReviews:async()=>ready({records:[record],cases:{case1:reviewCase(['judgement-1']),case2:reviewCase(['judgement-2'])}})},projectObservation:{read:()=>ready({projectId:'project-1'})},sessionHistory:{resolveSessionFiles:async()=>ready({sessionFiles:['session']})},getUserDataPath:()=>'.',openDatabase:async()=>({close(){}}),createStore:()=>store,readFile:async()=>'',adaptSession:()=>({session:{sessionId:'session-1',turns:[turn('turn-1'),turn('turn-2')]}}),createAdapter:()=>({descriptor:{provider:'test',model:'classifier'},review:async request=>({output:{decisions:request.evidencePackage.optimizationClassification.sources.map(source=>({dailyIssueId:source.dailyIssueId,targetType:'new',targetId:`group-${source.dailyIssueId}`,confidence:.8,rationale:'New group.',signals:[]}))}})}),createId:sequence()});
  await service.processProject('C:\\project'); const issues=(await service.list('C:\\project')).data;
  assert.equal(issues.length,1); assert.equal(issues[0].metrics.episodeCount,1); assert.equal(issues[0].metrics.turnCount,2); assert.equal(issues[0].metrics.toolCallCount,4);
});

function daily(batchId,localDate,issueId,judgementId){return {batch:{batchId,projectId:'project-1',localDate,status:'completed'},chunks:[{chunkId:`chunk-${batchId}`,batchId,groupKey:'task:one',reviewCaseId:'case1',turns:[{sessionId:'session-1',turnId:'turn-1'}]}],issues:[{issueId,batchId,issueFingerprint:'repeated_failure:argument-forwarding',category:'repeated_failure',title:'Argument forwarding fails',summary:'Arguments are lost.',severity:'medium',impact:'Retries.',recommendation:'Use stable forwarding.',sourceJudgementIds:[judgementId],createdAt:`${localDate}T12:00:00Z`} ]};}
function reviewCase(ids){return {judgements:ids.map(id=>({judgementId:id,title:'Failure',summary:'Arguments lost.',impact:'Retries.',recommendation:'Fix forwarding.'})),evidence:ids.map(id=>({evidenceId:`evidence-${id}`,judgementId:id,description:'Repeated failed invocation.',cachedExcerpt:'failed'}))};}
function turn(turnId){return {turnId,durationMs:100,usage:{inputTokens:10,outputTokens:5,totalTokens:15},events:[{type:'tool_call',sourceToolName:'exec',data:{command:'test'},status:'failed'},{type:'tool_call',sourceToolName:'exec',data:{command:'test'},status:'failed'}]};}
function ready(data){return {status:'ready',source:'test',data,error:null};}
function sequence(){let value=0;return()=>String(++value);}
