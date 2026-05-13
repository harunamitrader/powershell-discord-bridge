Option Explicit

Dim shell, fso, repoRoot, launcherPath

Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

repoRoot = fso.GetParentFolderName(WScript.ScriptFullName)
launcherPath = fso.BuildPath(repoRoot, "launch-powershell-discord-bridge.cmd")

If Not fso.FileExists(launcherPath) Then
  MsgBox "Required file not found: " & launcherPath, vbCritical, "PowerShell Discord Bridge"
  WScript.Quit 1
End If

shell.CurrentDirectory = repoRoot
shell.Run "cmd.exe /c """ & launcherPath & """", 0, False
