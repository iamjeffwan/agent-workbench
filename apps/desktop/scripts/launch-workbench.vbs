Set shell = CreateObject("WScript.Shell")
shell.CurrentDirectory = "F:\agent-workbench\apps\desktop"
shell.Run """D:\workspace\nodejs\node.exe"" ""F:\agent-workbench\apps\desktop\scripts\run-electron.mjs""", 0, False
