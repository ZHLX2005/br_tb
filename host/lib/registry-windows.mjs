// Windows 注册表写入:Chrome + Edge 双注册,HKCU 不需要管理员。
// 用 PowerShell 而非 reg.exe,原因是:
//   - PowerShell 对引号/转义处理更稳
//   - 同时给 Chrome 和 Edge 写时,PS 比批处理 reg.exe 错误信息友好
//
// ⚠️ PowerShell 语句分隔符是换行或分号 —— 把多行脚本折叠成一行时**必须用 "; "**
//    连接,用空格连接会让相邻语句粘连(parser error:"表达式或语句中包含意外的标记")。
//
// 失败不抛(返回 ok=false + message),init 命令自己决定要不要报错。
import { spawn } from 'node:child_process';

const BROWSER_KEYS = [
  { vendor: 'Chrome', path: 'Software\\Google\\Chrome\\NativeMessagingHosts' },
  { vendor: 'Edge',   path: 'Software\\Microsoft\\Edge\\NativeMessagingHosts' },
];

// 导出供 doctor.mjs 复用,inline PowerShell 脚本。
export function runPowerShell(script) {
  return new Promise((resolve) => {
    const ps = spawn('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-Command', script,
    ], { windowsHide: true });
    let stderr = '';
    let stdout = '';
    ps.stderr.on('data', d => { stderr += d.toString(); });
    ps.stdout.on('data', d => { stdout += d.toString(); });
    ps.on('close', code => {
      if (code === 0) resolve({ ok: true, stdout: stdout.trim() });
      else resolve({ ok: false, code, stderr: stderr.trim() });
    });
    ps.on('error', err => resolve({ ok: false, message: err.message }));
  });
}

// 注册 hostName → manifestPath,Chrome + Edge 都写。
// manifestPath 必须是绝对路径,反斜杠要转义。
export async function registerHost(hostName, manifestPath) {
  // PowerShell 单引号字符串里,单引号自身用两个单引号转义;反斜杠无需转义
  const psPath = manifestPath.replace(/'/g, "''");
  const results = [];

  for (const b of BROWSER_KEYS) {
    const regKey = `HKCU:\\${b.path}\\${hostName}`;
    // 语句数组用 "; " 连接 —— PowerShell 的一行多语句分隔符
    const script = [
      `$ErrorActionPreference = 'Stop'`,
      `try {`,
      `  New-Item -Path '${regKey}' -Force | Out-Null`,
      `  Set-ItemProperty -LiteralPath '${regKey}' -Name '(default)' -Value '${psPath}'`,
      `  Write-Output 'ok:${b.vendor}'`,
      `} catch {`,
      `  Write-Error $_.Exception.Message`,
      `  exit 1`,
      `}`,
    ].join('; ');

    const r = await runPowerShell(script);
    results.push({ vendor: b.vendor, ...r });
  }

  return {
    ok: results.every(r => r.ok),
    results,
  };
}

// 注销
export async function unregisterHost(hostName) {
  const results = [];
  for (const b of BROWSER_KEYS) {
    const regKey = `HKCU:\\${b.path}\\${hostName}`;
    const script = [
      `Remove-Item -LiteralPath '${regKey}' -ErrorAction SilentlyContinue`,
      `exit 0`,
    ].join('; ');
    const r = await runPowerShell(script);
    results.push({ vendor: b.vendor, ...r });
  }
  return { ok: true, results };
}
