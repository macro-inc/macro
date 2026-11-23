; Tauri NSIS installer hooks (bundle > windows > nsis > installerHooks).
;
; Macro runs the bundled macrod.exe from the install directory, and Windows
; cannot replace or delete an executable while it runs. The template stops
; Macro.exe itself; macrod exits soon after its parent, but not always before
; the installer reaches its file. Stop whatever runs that exact file first, the
; way the template stops Macro (Restart Manager). A separately installed macrod
; elsewhere on the machine is a different file and keeps running.

!macro MacroStopBundledMacrod
  !insertmacro RestartManager_StartSession $R0
  ${If} $R0 != ""
    !insertmacro RestartManager_RegisterFile $R0 "$INSTDIR\macrod.exe"
    ${If} $0 = 0
      System::Call 'RSTRTMGR::RmShutdown(p R0, i ${RmForceShutdown}, p 0) i .r0'
    ${EndIf}
    !insertmacro RestartManager_EndSession $R0
  ${EndIf}
!macroend

!macro NSIS_HOOK_PREINSTALL
  !insertmacro MacroStopBundledMacrod
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  !insertmacro MacroStopBundledMacrod
!macroend
