#!/usr/bin/env node
/**
 * Create a Windows Desktop shortcut that launches Agent Workbench
 * without keeping a console window open.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(__dirname, '..');
const assetsDir = path.join(appRoot, 'assets');
const iconPng = path.join(assetsDir, 'icon.png');
const iconIco = path.join(assetsDir, 'icon.ico');
const launcherVbs = path.join(appRoot, 'scripts', 'launch-workbench.vbs');
function resolveDesktopDir() {
  const result = spawnSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-Command',
      "[Environment]::GetFolderPath('Desktop')",
    ],
    { encoding: 'utf8' },
  );
  const fromShell = (result.stdout || '').trim();
  if (result.status === 0 && fromShell && fs.existsSync(fromShell)) {
    return fromShell;
  }
  const fallbacks = [
    path.join(os.homedir(), 'Desktop'),
    path.join(os.homedir(), '桌面'),
  ];
  for (const candidate of fallbacks) {
    if (fs.existsSync(candidate)) return candidate;
  }
  throw new Error('Desktop folder not found');
}

const desktopDir = resolveDesktopDir();
const shortcutPath = path.join(desktopDir, 'Agent Workbench.lnk');

function vbsQuote(value) {
  return String(value).replaceAll('"', '""');
}

function ensureIco() {
  if (!fs.existsSync(iconPng)) {
    throw new Error(`Missing icon: ${iconPng}`);
  }
  const result = spawnSync(
    process.execPath,
    [path.join(__dirname, 'png-to-ico.mjs'), iconPng, iconIco],
    { encoding: 'utf8' },
  );
  if (result.status !== 0) {
    throw new Error(result.stderr || 'Failed to build icon.ico');
  }
}

function writeLauncher() {
  const runElectron = path.join(appRoot, 'scripts', 'run-electron.mjs');
  const vbs = [
    'Set shell = CreateObject("WScript.Shell")',
    `shell.CurrentDirectory = "${vbsQuote(appRoot)}"`,
    `shell.Run """${vbsQuote(process.execPath)}"" ""${vbsQuote(runElectron)}""", 0, False`,
    '',
  ].join('\r\n');
  fs.writeFileSync(launcherVbs, vbs, 'utf8');
}

function createShortcut() {
  const ps1Path = path.join(appRoot, 'scripts', '_write-shortcut.ps1');
  const ps1 = [
    "$ErrorActionPreference = 'Stop'",
    `$shortcutPath = ${JSON.stringify(shortcutPath)}`,
    `$targetPath = ${JSON.stringify(launcherVbs)}`,
    `$workingDirectory = ${JSON.stringify(appRoot)}`,
    `$iconLocation = ${JSON.stringify(`${iconIco},0`)}`,
    '$w = New-Object -ComObject WScript.Shell',
    '$s = $w.CreateShortcut($shortcutPath)',
    '$s.TargetPath = $targetPath',
    '$s.WorkingDirectory = $workingDirectory',
    '$s.WindowStyle = 7',
    "$s.Description = 'Agent Workbench'",
    '$s.IconLocation = $iconLocation',
    '$s.Save()',
    'Write-Output $shortcutPath',
    '',
  ].join('\r\n');
  fs.writeFileSync(ps1Path, ps1, 'utf8');

  const result = spawnSync(
    'powershell.exe',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ps1Path],
    { encoding: 'utf8' },
  );
  fs.unlinkSync(ps1Path);
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || 'Shortcut creation failed');
  }
  return (result.stdout || '').trim() || shortcutPath;
}

ensureIco();
writeLauncher();
const created = createShortcut();
console.log(
  JSON.stringify(
    {
      shortcut: created,
      icon: iconIco,
      launcher: launcherVbs,
      tip: '桌面双击 “Agent Workbench” 即可打开。',
    },
    null,
    2,
  ),
);
