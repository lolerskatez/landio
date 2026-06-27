/**
 * System Utilities
 * Handles system information retrieval, platform detection,
 * and safe reboot/shutdown execution with Docker-aware host reboot.
 */

const os = require('os');
const fs = require('fs');
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);

// ─── Docker Detection ─────────────────────────────────────────────────────────

/**
 * Detects if the application is running inside a Docker container.
 * @returns {boolean}
 */
function isRunningInContainer() {
  try {
    if (fs.existsSync('/.dockerenv')) return true;
    if (fs.existsSync('/proc/1/cgroup')) {
      const cgroup = fs.readFileSync('/proc/1/cgroup', 'utf8');
      if (cgroup.includes('docker') || cgroup.includes('containerd')) return true;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Checks if the Docker socket is available inside the container.
 * @returns {boolean}
 */
function isDockerSocketAvailable() {
  try {
    const paths = ['/var/run/docker.sock', '/run/docker.sock'];
    for (const p of paths) {
      if (fs.existsSync(p)) return true;
    }
    return false;
  } catch {
    return false;
  }
}

// ─── Platform Info ────────────────────────────────────────────────────────────

/**
 * Gets the OS name in a human-readable format.
 * @returns {string}
 */
function getOSName() {
  const platform = process.platform;
  if (platform === 'win32') {
    return `Windows ${os.release()}`;
  }
  if (platform === 'darwin') {
    return `macOS ${os.release()}`;
  }
  if (platform === 'linux') {
    try {
      // Try to get pretty name from /etc/os-release
      if (fs.existsSync('/etc/os-release')) {
        const content = fs.readFileSync('/etc/os-release', 'utf8');
        const match = content.match(/PRETTY_NAME="([^"]+)"/);
        if (match) return match[1];
      }
      // Fallback
      return `Linux ${os.release()}`;
    } catch {
      return `Linux ${os.release()}`;
    }
  }
  return `${platform} ${os.release()}`;
}

/**
 * Gets the system hostname.
 * @returns {string}
 */
function getHostname() {
  return os.hostname();
}

/**
 * Gets human-readable uptime string.
 * @param {number} [seconds] - Uptime in seconds (defaults to os.uptime())
 * @returns {string}
 */
function getUptimeHuman(seconds) {
  const uptime = seconds || os.uptime();
  const days = Math.floor(uptime / 86400);
  const hours = Math.floor((uptime % 86400) / 3600);
  const minutes = Math.floor((uptime % 3600) / 60);

  const parts = [];
  if (days > 0) parts.push(`${days} day${days !== 1 ? 's' : ''}`);
  if (hours > 0) parts.push(`${hours} hour${hours !== 1 ? 's' : ''}`);
  if (minutes > 0 || parts.length === 0) parts.push(`${minutes} minute${minutes !== 1 ? 's' : ''}`);

  return parts.join(', ');
}

/**
 * Gets kernel version (Linux/macOS) or OS build number (Windows).
 * @returns {string}
 */
function getKernelVersion() {
  return os.release();
}

// ─── CPU Info ─────────────────────────────────────────────────────────────────

/**
 * Gets CPU model information.
 * @returns {string}
 */
function getCPUModel() {
  const cpus = os.cpus();
  if (cpus.length > 0) {
    return cpus[0].model.trim();
  }
  return 'Unknown';
}

/**
 * Gets CPU load average (1, 5, 15 minutes).
 * Windows compatibility: uses CPU % as approximation.
 * @returns {number[]}
 */
function getLoadAverage() {
  if (process.platform === 'win32') {
    // Windows doesn't have loadavg, approximate with CPU usage
    const cpus = os.cpus();
    let totalIdle = 0;
    let totalTick = 0;
    cpus.forEach(cpu => {
      for (const type in cpu.times) {
        totalTick += cpu.times[type];
      }
      totalIdle += cpu.times.idle;
    });
    const idlePercent = totalIdle / totalTick;
    return [1 - idlePercent, 1 - idlePercent, 1 - idlePercent];
  }
  return os.loadavg();
}

// ─── Memory Info ──────────────────────────────────────────────────────────────

/**
 * Gets memory usage information.
 * @returns {Object}
 */
function getMemoryInfo() {
  const total = os.totalmem();
  const free = os.freemem();
  const used = total - free;
  const percentUsed = total > 0 ? (used / total) * 100 : 0;

  return {
    total,
    used,
    free,
    percentUsed: Math.round(percentUsed * 100) / 100,
    totalHuman: formatBytes(total),
    usedHuman: formatBytes(used),
    freeHuman: formatBytes(free),
  };
}

// ─── Disk Info ─────────────────────────────────────────────────────────────────

/**
 * Gets disk usage information.
 * On Windows, uses `wmic` to get disk info.
 * On Linux/macOS, uses `df`.
 * @returns {Promise<Object>}
 */
async function getDiskInfo() {
  const platform = process.platform;

  try {
    if (platform === 'win32') {
      // Use wmic on Windows
      const { stdout } = await execPromise(
        'wmic logicaldisk get size,freespace,caption /format:csv'
      );
      const drives = [];
      const lines = stdout.trim().split('\n').slice(1); // skip header
      for (const line of lines) {
        const parts = line.split(',');
        if (parts.length >= 4) {
          const drive = {
            mount: parts[1]?.trim(),
            free: parseInt(parts[2]) || 0,
            total: parseInt(parts[3]) || 0,
          };
          drive.used = drive.total - drive.free;
          drive.percentUsed = drive.total > 0
            ? Math.round((drive.used / drive.total) * 10000) / 100
            : 0;
          drives.push(drive);
        }
      }

      // Aggregate
      const total = drives.reduce((sum, d) => sum + d.total, 0);
      const used = drives.reduce((sum, d) => sum + d.used, 0);
      const free = drives.reduce((sum, d) => sum + d.free, 0);

      return {
        total,
        used,
        free,
        percentUsed: total > 0 ? Math.round((used / total) * 10000) / 100 : 0,
        totalHuman: formatBytes(total),
        usedHuman: formatBytes(used),
        freeHuman: formatBytes(free),
        drives,
      };
    } else {
      // Linux/macOS: use df
      const { stdout } = await execPromise('df -k /');
      const lines = stdout.trim().split('\n');
      if (lines.length >= 2) {
        const parts = lines[1].split(/\s+/);
        if (parts.length >= 4) {
          const total = parseInt(parts[1]) * 1024 || 0;
          const used = parseInt(parts[2]) * 1024 || 0;
          const free = parseInt(parts[3]) * 1024 || 0;

          return {
            total,
            used,
            free,
            percentUsed: total > 0 ? Math.round((used / total) * 10000) / 100 : 0,
            totalHuman: formatBytes(total),
            usedHuman: formatBytes(used),
            freeHuman: formatBytes(free),
            drives: [{ mount: '/', total, used, free, percentUsed: total > 0 ? Math.round((used / total) * 10000) / 100 : 0 }],
          };
        }
      }
    }
  } catch (err) {
    console.warn('Could not get disk info:', err.message);
  }

  // Fallback
  return {
    total: 0,
    used: 0,
    free: 0,
    percentUsed: 0,
    totalHuman: 'N/A',
    usedHuman: 'N/A',
    freeHuman: 'N/A',
    drives: [],
  };
}

// ─── System Information ───────────────────────────────────────────────────────

/**
 * Gets comprehensive system information.
 * @returns {Promise<Object>}
 */
async function getSystemInfo() {
  const inContainer = isRunningInContainer();
  const dockerSocketAvail = isDockerSocketAvailable();
  const memory = getMemoryInfo();
  const disk = await getDiskInfo();

  return {
    hostname: getHostname(),
    platform: process.platform,
    os: getOSName(),
    kernel: getKernelVersion(),
    arch: os.arch(),
    uptime: os.uptime(),
    uptimeHuman: getUptimeHuman(),
    isContainer: inContainer,
    isDockerSocketAvailable: dockerSocketAvail,
    cpuModel: getCPUModel(),
    cpuCores: os.cpus().length,
    loadAvg: getLoadAverage(),
    memory: memory,
    disk: disk,
    nodeVersion: process.version,
    pid: process.pid,
    timestamp: new Date().toISOString(),
  };
}

// ─── Reboot / Shutdown Execution ──────────────────────────────────────────────

// Pending operation state
let pendingOperation = null;

/**
 * Gets the current pending operation status.
 * @returns {Object|null}
 */
function getPendingOperation() {
  return pendingOperation;
}

/**
 * Cancels a pending operation by token.
 * @param {string} token - Cancel token
 * @returns {boolean} Whether the operation was cancelled
 */
function cancelOperation(token) {
  if (pendingOperation && pendingOperation.cancelToken === token && !pendingOperation.executed) {
    clearTimeout(pendingOperation.timeout);
    pendingOperation.cancelled = true;
    pendingOperation.executed = true;
    return true;
  }
  return false;
}

/**
 * Executes a reboot or shutdown command on the host system.
 * Docker-aware: If running in a container and Docker socket is available,
 * it will attempt to reboot the HOST, not the container.
 *
 * @param {'reboot'|'shutdown'} action - Action to perform
 * @param {number} [delay=60] - Delay in seconds
 * @param {string} [reason=''] - Reason for the action
 * @returns {Promise<{ success: boolean, method: string, message: string }>}
 */
async function executeSystemAction(action, delay = 60, reason = '') {
  const platform = process.platform;
  const inContainer = isRunningInContainer();
  const dockerSocketAvail = isDockerSocketAvailable();

  // ── Docker-aware host reboot ──
  // If we're inside a Docker container AND have the Docker socket,
  // we can use the host's Docker daemon to reboot the HOST system.
  if (inContainer && dockerSocketAvail) {
    try {
      const Docker = require('dockerode');
      const docker = new Docker({ socketPath: '/var/run/docker.sock' });

      // Run a temporary privileged container that reboots the host.
      // The container mounts the host's root filesystem and runs the reboot command.
      const cmd = platform === 'win32'
        ? ['sh', '-c', `shutdown /${action === 'reboot' ? 'r' : 's'} /t ${delay} /c "Landio Dashboard: ${reason || action}"`]
        : ['sh', '-c', `sleep ${delay} && /sbin/${action} ${reason ? `"+${reason}"` : ''}`];

      await docker.run('ubuntu:latest', cmd, null, {
        HostConfig: {
          Privileged: true,
          PidMode: 'host',
          NetworkMode: 'host',
          Mounts: [{
            Type: 'bind',
            Source: '/',
            Target: '/host',
          }],
          AutoRemove: true,
        },
      });

      return {
        success: true,
        method: 'docker-privileged',
        message: `${action} initiated via Docker privileged container`,
      };
    } catch (err) {
      console.error(`Docker ${action} failed, falling back to direct execution:`, err.message);
      // Fall through to direct execution
    }
  }

  // ── Direct execution (non-Docker or fallback) ──
  try {
    let command;

    if (platform === 'win32') {
      // Windows: shutdown.exe
      const shutdownFlag = action === 'reboot' ? '/r' : '/s';
      command = `shutdown ${shutdownFlag} /t ${delay} /c "Landio Dashboard: ${reason || action.replace(/^\w/, c => c.toUpperCase())}"`;
    } else if (platform === 'linux' || platform === 'darwin') {
      // Linux/macOS: shutdown command
      const shutdownDelay = Math.max(0, delay);
      const reasonStr = reason ? `"${reason}"` : '"Landio Dashboard initiated"';
      command = `sudo /sbin/shutdown ${action === 'reboot' ? '-r' : '-h'} +${Math.ceil(shutdownDelay / 60)} ${reasonStr}`;
    } else {
      throw new Error(`Unsupported platform: ${platform}`);
    }

    console.log(`Executing system ${action}:`, command);
    exec(command, (error) => {
      if (error) {
        console.error(`System ${action} failed:`, error.message);
      }
    });

    return {
      success: true,
      method: 'direct-exec',
      message: `${action} command executed`,
    };
  } catch (err) {
    return {
      success: false,
      method: 'none',
      message: err.message,
    };
  }
}

/**
 * Schedules a reboot or shutdown with a configurable delay and cancel window.
 * @param {'reboot'|'shutdown'} action - Action to perform
 * @param {string} triggeredBy - Username who triggered the action
 * @param {Object} [options] - Options
 * @param {number} [options.delay=60] - Delay in seconds
 * @param {string} [options.reason=''] - Reason for the action
 * @returns {Promise<{ success: boolean, cancelToken: string, scheduledAt: string, delay: number }>}
 */
async function scheduleSystemAction(action, triggeredBy, options = {}) {
  const delay = options.delay || 60;
  const reason = options.reason || '';

  // Cancel any existing pending operation
  if (pendingOperation && !pendingOperation.executed) {
    clearTimeout(pendingOperation.timeout);
  }

  const cancelToken = generateCancelToken();

  // Schedule the execution
  const timeout = setTimeout(async () => {
    try {
      const result = await executeSystemAction(action, 0, reason);
      pendingOperation.executed = true;
      pendingOperation.result = result;
    } catch (err) {
      pendingOperation.executed = true;
      pendingOperation.result = { success: false, message: err.message };
    }
  }, delay * 1000);

  pendingOperation = {
    action,
    triggeredBy,
    reason,
    delay,
    cancelToken,
    scheduledAt: new Date().toISOString(),
    executed: false,
    cancelled: false,
    timeout,
    result: null,
  };

  return {
    success: true,
    cancelToken,
    scheduledAt: pendingOperation.scheduledAt,
    delay,
    action,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Formats bytes into human-readable string.
 * @param {number} bytes
 * @returns {string}
 */
function formatBytes(bytes) {
  if (bytes === 0 || !bytes) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * Generates a random cancel token.
 * @returns {string}
 */
function generateCancelToken() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let token = '';
  for (let i = 0; i < 32; i++) {
    token += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return token;
}

// ─── Module Exports ───────────────────────────────────────────────────────────

module.exports = {
  isRunningInContainer,
  isDockerSocketAvailable,
  getSystemInfo,
  getMemoryInfo,
  getDiskInfo,
  getCPUModel,
  getLoadAverage,
  getUptimeHuman,
  getPendingOperation,
  cancelOperation,
  executeSystemAction,
  scheduleSystemAction,
  formatBytes,
};
