Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

projectDir = fso.GetParentFolderName(WScript.ScriptFullName)
command = "cmd /c """ & projectDir & "\Launch Autonomous Car Salesman New Instance.cmd"""

shell.Run command, 0, False
