import * as React from 'react';
import { styled } from '../upstream/theme';
import type { OptimizationIssue, OptimizationIssueDetail, ReviewResult, TemporaryPrompt } from './workbench-data';
import { TemporaryPromptsPage } from './TemporaryPromptsPage';

const Page = styled.main`height:100vh;overflow:auto;padding:28px 38px;box-sizing:border-box;background:${p=>p.theme.containerBackground};color:${p=>p.theme.mainColor};`;
const Tabs = styled.div`display:flex;gap:8px;max-width:1100px;margin:0 auto 24px;border-bottom:1px solid ${p=>p.theme.containerBorder};`;
const Tab = styled.button<{selected:boolean}>`border:0;border-bottom:3px solid ${p=>p.selected?p.theme.popColor:'transparent'};background:transparent;color:inherit;padding:11px 14px;cursor:pointer;font-weight:${p=>p.selected?700:400};`;
const Layout = styled.div`max-width:1100px;margin:0 auto;display:grid;grid-template-columns:minmax(280px,360px) minmax(0,1fr);gap:18px;@media(max-width:850px){grid-template-columns:1fr;}`;
const Panel = styled.section`border:1px solid ${p=>p.theme.containerBorder};border-radius:6px;background:${p=>p.theme.mainBackground};padding:16px;`;
const IssueButton = styled.button<{selected:boolean}>`display:block;width:100%;text-align:left;margin:0 0 8px;padding:12px;border:1px solid ${p=>p.selected?p.theme.popColor:p.theme.containerBorder};border-radius:5px;background:${p=>p.theme.mainBackground};color:inherit;cursor:pointer;h3{margin:0 0 6px;font-size:15px;}p{margin:0;font-size:12px;}`;
const Metrics = styled.dl`display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin:14px 0;dt{font-size:11px;}dd{margin:2px 0 0;font-size:18px;font-variant-numeric:tabular-nums;}`;
const Button = styled.button`border:1px solid ${p=>p.theme.containerBorder};border-radius:4px;background:transparent;color:inherit;padding:7px 10px;cursor:pointer;`;
const Source = styled.article`margin:12px 0;padding:12px;border-left:3px solid ${p=>p.theme.popColor};background:${p=>p.theme.containerBackground};`;
const Form = styled.div`display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:10px;select{min-width:180px;padding:6px;}`;

type Props = {
  projectRoot:string|null;
  listPrompts(root?:string|null):Promise<ReviewResult<TemporaryPrompt[]>>; hidePrompt(root:string|null,id:string):Promise<ReviewResult<TemporaryPrompt|null>>;
  listIssues(root?:string|null):Promise<ReviewResult<OptimizationIssue[]>>; getIssue(root:string|null,id:string):Promise<ReviewResult<OptimizationIssueDetail|null>>;
  retry(root?:string|null):Promise<ReviewResult<{processed:number}|null>>;
  reassign(root:string|null,dailyId:string,targetId?:string):Promise<ReviewResult<OptimizationIssueDetail|null>>;
  merge(root:string|null,sourceId:string,targetId:string):Promise<ReviewResult<OptimizationIssueDetail|null>>;
};

export function OptimizationPage(props:Props){
  const [tab,setTab]=React.useState<'prompts'|'issues'>('issues');
  return <Page><Tabs role="tablist" aria-label="Optimization sections"><Tab role="tab" selected={tab==='prompts'} aria-selected={tab==='prompts'} onClick={()=>setTab('prompts')}>Temporary prompts</Tab><Tab role="tab" selected={tab==='issues'} aria-selected={tab==='issues'} onClick={()=>setTab('issues')}>Optimization issues</Tab></Tabs>
    {tab==='prompts'?<div style={{maxWidth:1100,margin:'0 auto'}}><TemporaryPromptsPage embedded projectRoot={props.projectRoot} listPrompts={props.listPrompts} hidePrompt={props.hidePrompt}/></div>:<Issues {...props}/>}</Page>;
}

function Issues(props:Props){
  const [issues,setIssues]=React.useState<OptimizationIssue[]>([]); const [selected,setSelected]=React.useState<string|null>(null); const [detail,setDetail]=React.useState<OptimizationIssueDetail|null>(null); const [message,setMessage]=React.useState<string|null>(null);
  const load=React.useCallback(async()=>{const result=await props.listIssues(props.projectRoot);if(result.status==='ready'){setIssues(result.data);setSelected(current=>current??result.data[0]?.issueId??null);setMessage(null);}else setMessage(result.error);},[props.listIssues,props.projectRoot]);
  React.useEffect(()=>{void load();},[load]); React.useEffect(()=>{if(!selected){setDetail(null);return;}void props.getIssue(props.projectRoot,selected).then(result=>{if(result.status==='ready')setDetail(result.data);else setMessage(result.error);});},[props.getIssue,props.projectRoot,selected]);
  const refresh=async()=>{await load();if(selected){const result=await props.getIssue(props.projectRoot,selected);setDetail(result.data);}};
  return <Layout><Panel><h1>Optimization issues</h1><p>Automatically grouped findings from completed daily reviews.</p>{message?<p role="alert">{message}</p>:null}<Button onClick={()=>void props.retry(props.projectRoot).then(refresh)}>Retry pending</Button><div style={{marginTop:14}}>{issues.length===0?<p>No optimization issues yet. Complete a daily review to start the pool.</p>:issues.map(issue=><IssueButton key={issue.issueId} selected={selected===issue.issueId} onClick={()=>setSelected(issue.issueId)}><h3>{issue.title}</h3><p>{issue.metrics.episodeCount} events · {issue.metrics.activeDayCount} days · {issue.classificationStatus.replace('_',' ')}</p></IssueButton>)}</div></Panel>
    <Panel>{detail?<IssueDetail issue={detail} issues={issues} onReassign={async(daily,target)=>{const result=await props.reassign(props.projectRoot,daily,target);if(result.status==='ready')await refresh();else setMessage(result.error);}} onMerge={async target=>{const result=await props.merge(props.projectRoot,detail.issueId,target);if(result.status==='ready'){setSelected(target);await load();}else setMessage(result.error);}}/>:<p>Select an optimization issue to inspect its history and metrics.</p>}</Panel></Layout>;
}

function IssueDetail({issue,issues,onReassign,onMerge}:{issue:OptimizationIssueDetail;issues:OptimizationIssue[];onReassign(id:string,target?:string):Promise<void>;onMerge(target:string):Promise<void>}){
  const [mergeTarget,setMergeTarget]=React.useState('');
  return <><h2>{issue.title}</h2><p>{issue.summary}</p><small>{issue.category.replaceAll('_',' ')} · {issue.firstSeenAt} to {issue.lastSeenAt} · {issue.highestSeverity}</small>{issue.classificationError?<p role="alert">Classification error: {issue.classificationError}</p>:null}<Metrics><Metric label="Events" value={issue.metrics.episodeCount}/><Metric label="Days" value={issue.metrics.activeDayCount}/><Metric label="Daily issues" value={issue.metrics.dailyIssueCount}/><Metric label="Judgements" value={issue.metrics.judgementCount}/><Metric label="Evidence" value={issue.metrics.evidenceCount}/><Metric label="Turns" value={issue.metrics.turnCount}/><Metric label="Input tokens" value={issue.metrics.inputTokens}/><Metric label="Output tokens" value={issue.metrics.outputTokens}/><Metric label="Total tokens" value={issue.metrics.totalTokens}/><Metric label="Duration (ms)" value={issue.metrics.durationMs}/><Metric label="Tool calls" value={issue.metrics.toolCallCount}/><Metric label="Failed calls" value={issue.metrics.failedToolCallCount}/><Metric label="Repeated calls" value={issue.metrics.repeatedToolCallCount}/></Metrics>
    {!issue.metrics.metricsComplete?<p><small>Some source metrics were unavailable; displayed totals are partial.</small></p>:null}
    {issue.signals.length?<><h3>Impact signals</h3>{issue.signals.map(signal=><p key={signal.key}><strong>{signal.label}</strong> · {signal.level} · {Math.round(signal.confidence*100)}% · {signal.occurrenceCount} occurrences<br/><small>{signal.rationale}</small></p>)}</>:null}
    <h3>Daily history</h3>{issue.assignments.map(item=><Source key={item.dailyIssueId}><strong>{item.source.localDate} · {item.source.title}</strong><p>{item.source.summary}</p><small>{item.source.severity} · {item.source.episodes.length} task events · classification {Math.round(item.confidence*100)}% · {item.rationale}</small>{item.classificationError?<p role="alert">{item.classificationError}</p>:null}{item.source.episodes.map(episode=><p key={episode.episodeKey}><small>{episode.groupKey} · {episode.metrics.turnCount??0} turns · {episode.metrics.totalTokens??0} tokens · {episode.metrics.toolCallCount??0} calls · {episode.metrics.repeatedToolCallCount??0} repeated</small></p>)}{item.source.judgements.map(judgement=><div key={judgement.judgementId}><p><strong>{judgement.title}</strong> — {judgement.summary}</p>{judgement.evidence.map(evidence=><p key={evidence.evidenceId}><small>Evidence: {evidence.description}{evidence.excerpt?` — ${evidence.excerpt}`:''}</small></p>)}</div>)}<Form><label>Move to <select defaultValue="" onChange={event=>{if(event.target.value==='new')void onReassign(item.dailyIssueId);else if(event.target.value)void onReassign(item.dailyIssueId,event.target.value);event.target.value='';}}><option value="">Choose…</option><option value="new">New issue</option>{issues.filter(value=>value.issueId!==issue.issueId).map(value=><option key={value.issueId} value={value.issueId}>{value.title}</option>)}</select></label></Form></Source>)}
    {issues.length>1?<Form><label>Merge this issue into <select value={mergeTarget} onChange={event=>setMergeTarget(event.target.value)}><option value="">Choose…</option>{issues.filter(value=>value.issueId!==issue.issueId).map(value=><option key={value.issueId} value={value.issueId}>{value.title}</option>)}</select></label><Button disabled={!mergeTarget} onClick={()=>void onMerge(mergeTarget)}>Merge issues</Button></Form>:null}</>;
}
function Metric({label,value}:{label:string;value:number}){return <div><dt>{label}</dt><dd>{value.toLocaleString()}</dd></div>;}
