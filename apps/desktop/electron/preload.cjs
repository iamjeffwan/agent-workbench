'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('workbench', {
  openProject: () => ipcRenderer.invoke('project:open'),
  getState: () => ipcRenderer.invoke('project:getState'),
  refresh: () => ipcRenderer.invoke('project:refresh'),
  onState: (handler) => {
    const listener = (_event, state) => handler(state);
    ipcRenderer.on('project:state', listener);
    return () => ipcRenderer.removeListener('project:state', listener);
  },
});
