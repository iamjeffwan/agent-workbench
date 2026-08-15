'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('workbench', {
  openProject: () => ipcRenderer.invoke('project:open'),
  getState: () => ipcRenderer.invoke('project:getState'),
  refresh: () => ipcRenderer.invoke('project:refresh'),
  startLiveObservation: () => ipcRenderer.invoke('view:startLive'),
  useHistoryObservation: () => ipcRenderer.invoke('view:useHistory'),
  listConversationProjects: () => ipcRenderer.invoke('history:listProjects'),
  listConversations: (projectRoot) => ipcRenderer.invoke('history:listConversations', projectRoot),
  readConversation: (projectRoot, conversationId) => ipcRenderer.invoke('history:readConversation', projectRoot, conversationId),
  getTrackedSelection: (projectRoot) => ipcRenderer.invoke('history:getTrackedSelection', projectRoot),
  setTrackedSelection: (projectRoot, conversationIds) => ipcRenderer.invoke('history:setTrackedSelection', projectRoot, conversationIds),
  listTasks: (projectRoot) => ipcRenderer.invoke('tasks:list', projectRoot),
  readTask: (taskId) => ipcRenderer.invoke('tasks:read', taskId),
  createTask: (input) => ipcRenderer.invoke('tasks:create', input),
  discussTask: (taskId, message) => ipcRenderer.invoke('tasks:discuss', taskId, message),
  saveTaskScript: (taskId, input) => ipcRenderer.invoke('tasks:saveScript', taskId, input),
  onTaskChanged: (handler) => {
    const listener = (_event, change) => handler(change);
    ipcRenderer.on('tasks:changed', listener);
    return () => ipcRenderer.removeListener('tasks:changed', listener);
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
