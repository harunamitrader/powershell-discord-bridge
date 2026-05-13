Option Explicit

Dim shell, fso, repoRoot, launcherPath, splashScriptPath, signalPath, splashCommand, launchCommand

Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

repoRoot = fso.GetParentFolderName(WScript.ScriptFullName)
launcherPath = fso.BuildPath(repoRoot, "launch-powershell-discord-bridge.cmd")
splashScriptPath = fso.BuildPath(repoRoot, "launch-powershell-discord-bridge-splash.ps1")

If Not fso.FileExists(launcherPath) Then
  MsgBox "Required file not found: " & launcherPath, vbCritical, "PowerShell Discord Bridge"
  WScript.Quit 1
End If

If Not fso.FileExists(splashScriptPath) Then
  MsgBox "Required file not found: " & splashScriptPath, vbCritical, "PowerShell Discord Bridge"
  WScript.Quit 1
End If

signalPath = fso.BuildPath(shell.ExpandEnvironmentStrings("%TEMP%"), fso.GetTempName())
With fso.CreateTextFile(signalPath, True, False)
  .WriteLine "starting"
  .Close
End With

shell.CurrentDirectory = repoRoot
splashCommand = "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File " & Quote(splashScriptPath) & " -SignalPath " & Quote(signalPath)
shell.Run splashCommand, 0, False

launchCommand = "cmd.exe /c " & Quote(Quote(launcherPath) & " " & Quote(signalPath))
shell.Run launchCommand, 0, False

Function Quote(value)
  Quote = Chr(34) & value & Chr(34)
End Function
