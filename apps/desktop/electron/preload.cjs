'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('workbench', {
  openProject: () => ipcRenderer.invoke('project:open'),
  getState: () => ipcRenderer.invoke('project:getState'),
  refresh: () => ipcRenderer.invoke('project:refresh'),
  startLiveObservation: () => ipcRenderer.invoke('view:startLive'),
  useHistoryObservation: () => ipcRenderer.invoke('view:useHistory'),
  listSessionProjects: () => ipcRenderer.invoke('history:listProjects'),
  listSessions: (projectRoot) => ipcRenderer.invoke('history:listSessions', projectRoot),
  readSession: (projectRoot, sessionId) => ipcRenderer.invoke('history:readSession', projectRoot, sessionId),
  getTrackedSelection: (projectRoot) => ipcRenderer.invoke('history:getTrackedSelection', projectRoot),
  setTrackedSelection: (projectRoot, sessionIds) => ipcRenderer.invoke('history:setTrackedSelection', projectRoot, sessionIds),
  listTasks: (projectRoot) => ipcRenderer.invoke('tasks:list', projectRoot),
  readTask: (taskId) => ipcRenderer.invoke('tasks:read', taskId),
  createTask: (input) => ipcRenderer.invoke('tasks:create', input),
  discussTask: (taskId, message) => ipcRenderer.invoke('tasks:discuss', taskId, message),
  saveTaskScript: (taskId, input) => ipcRenderer.invoke('tasks:saveScript', taskId, input),
  startReview: (input) => ipcRenderer.invoke('review:start', input),
  listReviews: (projectRoot) => ipcRenderer.invoke('review:list', projectRoot),
  getReview: (projectRoot, caseId) => ipcRenderer.invoke('review:get', projectRoot, caseId),
  resolveReviewEvidence: (projectRoot, caseId, evidenceId) => ipcRenderer.invoke('review:resolveEvidence', projectRoot, caseId, evidenceId),
  appendReviewAnnotation: (projectRoot, input) => ipcRenderer.invoke('review:appendAnnotation', projectRoot, input),
  listSyncTasks: (projectRoot) => ipcRenderer.invoke('sync:listTasks', projectRoot),
  readSyncTask: (projectRoot, taskId) => ipcRenderer.invoke('sync:readTask', projectRoot, taskId),
  addTaskToSync: (taskId) => ipcRenderer.invoke('sync:addTask', taskId),
  getRepositoryStatus: (projectRoot) => ipcRenderer.invoke('sync:repositoryStatus', projectRoot),
  pullRepository: (projectRoot) => ipcRenderer.invoke('sync:pullRepository', projectRoot),
  publishRepository: (input) => ipcRenderer.invoke('sync:publishRepository', input),
  createGithubRepository: (input) => ipcRenderer.invoke('sync:createGithubRepository', input),
  onTaskChanged: (handler) => {
    const listener = (_event, change) => handler(change);
    ipcRenderer.on('tasks:changed', listener);
    return () => ipcRenderer.removeListener('tasks:changed', listener);
  },
  onReviewChanged: (handler) => {
    const listener = (_event, change) => handler(change);
    ipcRenderer.on('review:changed', listener);
    return () => ipcRenderer.removeListener('review:changed', listener);
  },
  listProjectAssets: (projectRoot) => ipcRenderer.invoke('assets:list', projectRoot),
  readProjectAsset: (projectRoot, relativePath) => ipcRenderer.invoke('assets:read', projectRoot, relativePath),
  createProjectAssetDraft: (input) => ipcRenderer.invoke('assets:createDraft', input),
  writeProjectAssetDraft: (input) => ipcRenderer.invoke('assets:writeDraft', input),
  initializeProjectDocs: (projectRoot) => ipcRenderer.invoke('assets:initializeDocs', projectRoot),
  createProjectDocsFolder: (projectRoot, relativePath) => ipcRenderer.invoke('assets:createFolder', projectRoot, relativePath),
  renameProjectDocsFolder: (projectRoot, relativePath, nextName) => ipcRenderer.invoke('assets:renameFolder', projectRoot, relativePath, nextName),
  trashProjectDocsFolder: (projectRoot, relativePath) => ipcRenderer.invoke('assets:trashFolder', projectRoot, relativePath),
  createProjectDocsDocument: (projectRoot, relativePath) => ipcRenderer.invoke('assets:createDocument', projectRoot, relativePath),
  renameProjectDocsDocument: (projectRoot, relativePath, nextName) => ipcRenderer.invoke('assets:renameDocument', projectRoot, relativePath, nextName),
  trashProjectDocsDocument: (projectRoot, relativePath) => ipcRenderer.invoke('assets:trashDocument', projectRoot, relativePath),
  getModelStatus: () => ipcRenderer.invoke('model:getStatus'),
  saveDeepSeekApiKey: (apiKey) => ipcRenderer.invoke('model:saveDeepSeekApiKey', apiKey),
  clearDeepSeekApiKey: () => ipcRenderer.invoke('model:clearDeepSeekApiKey'),
  testDeepSeekConnection: () => ipcRenderer.invoke('model:testDeepSeekConnection'),
  listModelCalls: () => ipcRenderer.invoke('model:listCalls'),
  readModelCall: (callId) => ipcRenderer.invoke('model:readCall', callId),
  onState: (handler) => {
    const listener = (_event, state) => handler(state);
    ipcRenderer.on('project:state', listener);
    return () => ipcRenderer.removeListener('project:state', listener);
  },
});
