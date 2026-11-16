// Opens the operating system's folder dialog on this computer: POST /api/fs/pick-folder.
import { execFile } from 'node:child_process';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { findOnPath } from './agents/catalog.ts';
import { HttpError } from './projects.ts';

const PROMPT = 'Choose a project folder';

// The Vista-style folder picker (IFileOpenDialog with FOS_PICKFOLDERS). The dialog is owned by a hidden
// TopMost form: an owned window stays above its owner, so the dialog opens in front of the browser.
const WINDOWS_SCRIPT = `
$ErrorActionPreference = 'Stop'
# Progress records would otherwise reach stderr as CLIXML.
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Windows.Forms
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

[ComImport, Guid("DC1C5A9C-E88A-4dde-A5A1-60F82A20AEF7")]
class FileOpenDialogClass {}

[ComImport, Guid("43826D1E-E718-42EE-BC55-A1E261C37BFE"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IShellItem {
  void BindToHandler(IntPtr pbc, ref Guid bhid, ref Guid riid, out IntPtr ppv);
  void GetParent(out IShellItem ppsi);
  void GetDisplayName(uint sigdnName, [MarshalAs(UnmanagedType.LPWStr)] out string ppszName);
  void GetAttributes(uint sfgaoMask, out uint psfgaoAttribs);
  void Compare(IShellItem psi, uint hint, out int piOrder);
}

// IFileDialog, preceded by IModalWindow::Show; methods after GetResult are not needed.
[ComImport, Guid("42f85136-db7e-439c-85f1-e4075d135fc8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IFileDialog {
  [PreserveSig] int Show(IntPtr hwndOwner);
  void SetFileTypes(uint cFileTypes, IntPtr rgFilterSpec);
  void SetFileTypeIndex(uint iFileType);
  void GetFileTypeIndex(out uint piFileType);
  void Advise(IntPtr pfde, out uint pdwCookie);
  void Unadvise(uint dwCookie);
  void SetOptions(uint fos);
  void GetOptions(out uint pfos);
  void SetDefaultFolder(IShellItem psi);
  void SetFolder(IShellItem psi);
  void GetFolder(out IShellItem ppsi);
  void GetCurrentSelection(out IShellItem ppsi);
  void SetFileName([MarshalAs(UnmanagedType.LPWStr)] string pszName);
  void GetFileName([MarshalAs(UnmanagedType.LPWStr)] out string pszName);
  void SetTitle([MarshalAs(UnmanagedType.LPWStr)] string pszTitle);
  void SetOkButtonLabel([MarshalAs(UnmanagedType.LPWStr)] string pszText);
  void SetFileNameLabel([MarshalAs(UnmanagedType.LPWStr)] string pszLabel);
  void GetResult(out IShellItem ppsi);
}

public static class DangoFolderPicker {
  const uint FOS_PICKFOLDERS = 0x20;
  const uint FOS_FORCEFILESYSTEM = 0x40;
  const uint SIGDN_FILESYSPATH = 0x80058000;
  const int ERROR_CANCELLED = unchecked((int)0x800704C7);

  public static string Pick(IntPtr owner, string title) {
    IFileDialog dialog = (IFileDialog)new FileOpenDialogClass();
    uint options;
    dialog.GetOptions(out options);
    dialog.SetOptions(options | FOS_PICKFOLDERS | FOS_FORCEFILESYSTEM);
    dialog.SetTitle(title);
    int hr = dialog.Show(owner);
    if (hr == ERROR_CANCELLED) return "";
    Marshal.ThrowExceptionForHR(hr);
    IShellItem item;
    dialog.GetResult(out item);
    string path;
    item.GetDisplayName(SIGDN_FILESYSPATH, out path);
    return path;
  }
}
'@
$owner = New-Object System.Windows.Forms.Form
$owner.TopMost = $true
$owner.ShowInTaskbar = $false
[Console]::Out.Write([DangoFolderPicker]::Pick($owner.Handle, '${PROMPT}'))
$owner.Dispose()
`;

interface Picker { command: string; args: string[]; cancelled: (code: number | null, stderr: string) => boolean }

function picker(): Picker {
  if (process.platform === 'win32') {
    // -EncodedCommand (UTF-16LE base64) passes the script without command-line quoting.
    const encoded = Buffer.from(WINDOWS_SCRIPT, 'utf16le').toString('base64');
    return { command: 'powershell.exe', args: ['-NoProfile', '-NonInteractive', '-STA', '-EncodedCommand', encoded], cancelled: () => false };
  }
  if (process.platform === 'darwin') {
    return {
      command: 'osascript', args: ['-e', `POSIX path of (choose folder with prompt "${PROMPT}")`],
      cancelled: (code, stderr) => code === 1 && /User canceled|-128/.test(stderr),
    };
  }
  // zenity and kdialog exit with code 1 when the person cancels.
  if (findOnPath('zenity')) return { command: 'zenity', args: ['--file-selection', '--directory', `--title=${PROMPT}`], cancelled: code => code === 1 };
  if (findOnPath('kdialog')) return { command: 'kdialog', args: ['--getexistingdirectory', homedir(), '--title', PROMPT], cancelled: code => code === 1 };
  throw new HttpError(501, 'No folder dialog is available. Install zenity or kdialog, or create the project by name.');
}

let open = false;

export async function pickFolder(): Promise<string | null> {
  if (open) throw new HttpError(409, 'A folder dialog is already open on this computer.');
  const p = picker();
  open = true;
  try {
    const output = await new Promise<string>((done, fail) => {
      // windowsHide hides the PowerShell console only; the dialog is its own window.
      execFile(p.command, p.args, { encoding: 'utf8', windowsHide: true }, (error, stdout, stderr) => {
        if (!error) return done(stdout);
        const code = typeof error.code === 'number' ? error.code : null;
        if (p.cancelled(code, stderr)) return done('');
        fail(new Error(`The folder dialog failed: ${stderr.trim() || error.message}`));
      });
    });
    const path = output.trim();
    return path ? resolve(path) : null;
  } finally {
    open = false;
  }
}
