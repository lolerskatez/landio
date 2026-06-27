/**
 * Docker Connection Utilities
 * Handles Docker socket detection, connection, and container operations
 * using the dockerode library.
 */

const Docker = require('dockerode');
const fs = require('fs');
const os = require('os');

// ─── Docker Detection ─────────────────────────────────────────────────────────

/**
 * Detects whether a Docker socket is available on this system.
 * Checks common paths for Linux, macOS, and Windows named pipes.
 * @returns {{ available: boolean, socketPath: string|null, error: string|null }}
 */
function detectDockerSocket() {
  const platform = os.platform();

  // Linux / macOS
  if (platform === 'linux' || platform === 'darwin') {
    const paths = [
      '/var/run/docker.sock',
      '/run/docker.sock',
    ];
    for (const p of paths) {
      try {
        fs.accessSync(p, fs.constants.R_OK | fs.constants.W_OK);
        return { available: true, socketPath: p, error: null };
      } catch {
        // try next path
      }
    }
    return { available: false, socketPath: null, error: 'Docker socket not found at any common path' };
  }

  // Windows — named pipe
  if (platform === 'win32') {
    try {
      const pipePath = '//./pipe/docker_engine';
      // On Windows we can't easily test the pipe, so we attempt connection
      return { available: true, socketPath: pipePath, error: null };
    } catch {
      return { available: false, socketPath: null, error: 'Docker named pipe not accessible' };
    }
  }

  return { available: false, socketPath: null, error: `Unsupported platform: ${platform}` };
}

/**
 * Checks if the application is running inside a Docker container.
 * @returns {boolean}
 */
function isRunningInContainer() {
  try {
    // Check for .dockerenv file (standard Docker indicator)
    if (fs.existsSync('/.dockerenv')) return true;

    // Check /proc/1/cgroup for 'docker' string
    if (fs.existsSync('/proc/1/cgroup')) {
      const cgroup = fs.readFileSync('/proc/1/cgroup', 'utf8');
      if (cgroup.includes('docker') || cgroup.includes('containerd')) return true;
    }

    return false;
  } catch {
    return false;
  }
}

// ─── Connection Management ────────────────────────────────────────────────────

let dockerClient = null;
let connectionType = null; // 'socket' | 'tcp' | 'pipe'

/**
 * Creates a Docker client based on the configured connection settings.
 * Settings are read from the global settings store via callback.
 * @param {Object} settings - Docker connection settings
 * @param {string} [settings.socketPath] - Unix socket path
 * @param {string} [settings.tcpHost] - TCP host
 * @param {number} [settings.tcpPort] - TCP port
 * @param {boolean} [settings.tlsEnabled] - TLS enabled for TCP
 * @returns {Docker|null}
 */
function createDockerClient(settings = {}) {
  const platform = os.platform();

  try {
    if (settings.tcpHost) {
      // TCP connection
      const protocol = settings.tlsEnabled ? 'https' : 'http';
      dockerClient = new Docker({
        host: settings.tcpHost,
        port: settings.tcpPort || 2375,
        protocol: protocol,
      });
      connectionType = 'tcp';
    } else if (platform === 'win32') {
      // Windows named pipe
      dockerClient = new Docker({
        socketPath: '//./pipe/docker_engine',
      });
      connectionType = 'pipe';
    } else {
      // Unix socket
      const socketPath = settings.socketPath || '/var/run/docker.sock';
      dockerClient = new Docker({
        socketPath: socketPath,
      });
      connectionType = 'socket';
    }

    return dockerClient;
  } catch (error) {
    console.error('Failed to create Docker client:', error.message);
    dockerClient = null;
    return null;
  }
}

/**
 * Gets the current Docker client, creating one if needed.
 * @param {Object} [settings] - Optional connection settings
 * @returns {Docker|null}
 */
function getDockerClient(settings) {
  if (!dockerClient && settings) {
    return createDockerClient(settings);
  }
  return dockerClient;
}

/**
 * Tests the Docker connection by pinging the daemon.
 * @param {Object} [settings] - Optional connection settings
 * @returns {Promise<{ connected: boolean, version: string|null, error: string|null }>}
 */
async function testDockerConnection(settings) {
  try {
    const client = settings ? createDockerClient(settings) : dockerClient;
    if (!client) {
      return { connected: false, version: null, error: 'No Docker client available' };
    }

    const info = await client.ping();
    const version = await client.version();
    return {
      connected: true,
      version: version?.Version || 'unknown',
      error: null,
    };
  } catch (error) {
    return {
      connected: false,
      version: null,
      error: error.message,
    };
  }
}

// ─── Container Operations ─────────────────────────────────────────────────────

/**
 * Lists all containers with optional filtering.
 * @param {Object} [options] - Docker list containers options
 * @param {boolean} [options.all=true] - Include stopped containers
 * @returns {Promise<Array>}
 */
async function listContainers(options = { all: true }) {
  const client = getDockerClient();
  if (!client) throw new Error('Docker client not available');

  const containers = await client.listContainers(options);
  return containers.map(c => ({
    id: c.Id,
    shortId: c.Id.substring(0, 12),
    name: (c.Names?.[0] || '').replace(/^\//, ''),
    image: c.Image,
    imageId: c.ImageID,
    state: c.State, // 'running' | 'exited' | 'paused' | 'created'
    status: c.Status,
    ports: (c.Ports || []).map(p => ({
      privatePort: p.PrivatePort,
      publicPort: p.PublicPort,
      type: p.Type,
      ip: p.IP,
    })),
    created: c.Created,
    mounts: (c.Mounts || []).map(m => ({
      source: m.Source,
      destination: m.Destination,
      mode: m.Mode,
      rw: m.RW,
    })),
    networks: Object.keys(c.NetworkSettings?.Networks || {}),
    labels: c.Labels || {},
    restartCount: c.RestartCount,
  }));
}

/**
 * Gets detailed information about a container.
 * @param {string} containerId - Container ID or name
 * @returns {Promise<Object>}
 */
async function inspectContainer(containerId) {
  const client = getDockerClient();
  if (!client) throw new Error('Docker client not available');

  const container = client.getContainer(containerId);
  const info = await container.inspect();

  // Strip sensitive environment variable values
  const env = (info.Config?.Env || []).map(e => {
    const parts = e.split('=');
    const key = parts[0];
    const val = parts.slice(1).join('=');
    const sensitiveKeys = ['password', 'secret', 'token', 'key', 'credential', 'passwd'];
    const isSensitive = sensitiveKeys.some(sk => key.toLowerCase().includes(sk));
    return isSensitive ? `${key}=********` : e;
  });

  return {
    id: info.Id,
    shortId: info.Id.substring(0, 12),
    name: info.Name?.replace(/^\//, ''),
    image: info.Config?.Image,
    state: {
      status: info.State?.Status,
      running: info.State?.Running,
      paused: info.State?.Paused,
      restarting: info.State?.Restarting,
      exitCode: info.State?.ExitCode,
      startedAt: info.State?.StartedAt,
      finishedAt: info.State?.FinishedAt,
    },
    config: {
      hostname: info.Config?.Hostname,
      exposedPorts: Object.keys(info.Config?.ExposedPorts || {}),
      env: env,
      cmd: info.Config?.Cmd,
      entrypoint: info.Config?.Entrypoint,
      labels: info.Config?.Labels || {},
      tty: info.Config?.Tty,
      workingDir: info.Config?.WorkingDir,
    },
    hostConfig: {
      networkMode: info.HostConfig?.NetworkMode,
      restartPolicy: info.HostConfig?.RestartPolicy?.Name,
      maxRestartCount: info.HostConfig?.RestartPolicy?.MaximumRetryCount,
      memoryLimit: info.HostConfig?.Memory,
      memorySwap: info.HostConfig?.MemorySwap,
      cpuShares: info.HostConfig?.CpuShares,
      cpuPeriod: info.HostConfig?.CpuPeriod,
      cpuQuota: info.HostConfig?.CpuQuota,
      privileged: info.HostConfig?.Privileged,
      portBindings: info.HostConfig?.PortBindings,
      binds: info.HostConfig?.Binds,
      volumesFrom: info.HostConfig?.VolumesFrom,
      logConfig: info.HostConfig?.LogConfig,
    },
    networkSettings: {
      ipAddress: info.NetworkSettings?.IPAddress,
      gateway: info.NetworkSettings?.Gateway,
      networks: Object.entries(info.NetworkSettings?.Networks || {}).map(([name, net]) => ({
        name,
        ipAddress: net.IPAddress,
        gateway: net.Gateway,
        macAddress: net.MacAddress,
      })),
    },
    mounts: (info.Mounts || []).map(m => ({
      type: m.Type,
      source: m.Source,
      destination: m.Destination,
      mode: m.Mode,
      rw: m.RW,
      propagation: m.Propagation,
    })),
    created: info.Created,
    platform: info.Platform,
    restartCount: info.RestartCount,
    sizeRootFs: info.SizeRootFs,
    sizeRw: info.SizeRw,
  };
}

/**
 * Starts a container.
 * @param {string} containerId - Container ID or name
 * @returns {Promise<Object>}
 */
async function startContainer(containerId) {
  const client = getDockerClient();
  if (!client) throw new Error('Docker client not available');

  const container = client.getContainer(containerId);
  await container.start();
  return { id: containerId, status: 'started' };
}

/**
 * Stops a container.
 * @param {string} containerId - Container ID or name
 * @param {number} [timeout=10] - Seconds to wait before force kill
 * @returns {Promise<Object>}
 */
async function stopContainer(containerId, timeout = 10) {
  const client = getDockerClient();
  if (!client) throw new Error('Docker client not available');

  const container = client.getContainer(containerId);
  await container.stop({ t: timeout });
  return { id: containerId, status: 'stopped' };
}

/**
 * Restarts a container.
 * @param {string} containerId - Container ID or name
 * @param {number} [timeout=10] - Seconds to wait before force kill
 * @returns {Promise<Object>}
 */
async function restartContainer(containerId, timeout = 10) {
  const client = getDockerClient();
  if (!client) throw new Error('Docker client not available');

  const container = client.getContainer(containerId);
  await container.restart({ t: timeout });
  return { id: containerId, status: 'restarted' };
}

/**
 * Pauses a container.
 * @param {string} containerId - Container ID or name
 * @returns {Promise<Object>}
 */
async function pauseContainer(containerId) {
  const client = getDockerClient();
  if (!client) throw new Error('Docker client not available');

  const container = client.getContainer(containerId);
  await container.pause();
  return { id: containerId, status: 'paused' };
}

/**
 * Unpauses a container.
 * @param {string} containerId - Container ID or name
 * @returns {Promise<Object>}
 */
async function unpauseContainer(containerId) {
  const client = getDockerClient();
  if (!client) throw new Error('Docker client not available');

  const container = client.getContainer(containerId);
  await container.unpause();
  return { id: containerId, status: 'unpaused' };
}

/**
 * Gets logs from a container.
 * @param {string} containerId - Container ID or name
 * @param {Object} [options] - Log options
 * @param {number} [options.tail=100] - Number of lines to return
 * @param {boolean} [options.timestamps=false] - Include timestamps
 * @param {boolean} [options.follow=false] - Follow logs (stream)
 * @param {boolean} [options.stdout=true] - Include stdout
 * @param {boolean} [options.stderr=true] - Include stderr
 * @returns {Promise<string>}
 */
async function getContainerLogs(containerId, options = {}) {
  const client = getDockerClient();
  if (!client) throw new Error('Docker client not available');

  const container = client.getContainer(containerId);
  const logOpts = {
    tail: options.tail || 100,
    timestamps: options.timestamps || false,
    follow: options.follow || false,
    stdout: options.stdout !== false,
    stderr: options.stderr !== false,
  };

  return new Promise((resolve, reject) => {
    container.logs(logOpts, (err, data) => {
      if (err) return reject(err);

      // Docker logs include a 8-byte header per line; strip it
      const lines = data.toString('utf8').split('\n').map(line => {
        if (line.length > 8) return line.substring(8);
        return line;
      });

      resolve(lines.join('\n'));
    });
  });
}

/**
 * Gets real-time stats for a container (CPU, memory, network).
 * @param {string} containerId - Container ID or name
 * @returns {Promise<Object>}
 */
async function getContainerStats(containerId) {
  const client = getDockerClient();
  if (!client) throw new Error('Docker client not available');

  const container = client.getContainer(containerId);
  const stats = await container.stats({ stream: false });

  // Calculate CPU percentage
  const cpuDelta = stats.cpu_stats.cpu_usage.total_usage - stats.precpu_stats.cpu_usage.total_usage;
  const systemDelta = stats.cpu_stats.system_cpu_usage - stats.precpu_stats.system_cpu_usage;
  const cpuCount = stats.cpu_stats.online_cpus || 1;
  const cpuPercent = systemDelta > 0 ? (cpuDelta / systemDelta) * cpuCount * 100 : 0;

  // Memory
  const memUsage = stats.memory_stats.usage || 0;
  const memLimit = stats.memory_stats.limit || 1;
  const memPercent = (memUsage / memLimit) * 100;

  // Network I/O
  let netRx = 0;
  let netTx = 0;
  if (stats.networks) {
    Object.values(stats.networks).forEach(net => {
      netRx += net.rx_bytes || 0;
      netTx += net.tx_bytes || 0;
    });
  }

  // Block I/O
  let blkRead = 0;
  let blkWrite = 0;
  if (stats.blkio_stats?.io_service_bytes_recursive) {
    stats.blkio_stats.io_service_bytes_recursive.forEach(entry => {
      if (entry.op === 'read') blkRead += entry.value;
      if (entry.op === 'write') blkWrite += entry.value;
    });
  }

  return {
    containerId,
    cpu: {
      percent: Math.round(cpuPercent * 100) / 100,
      delta: cpuDelta,
      systemDelta,
    },
    memory: {
      usage: memUsage,
      limit: memLimit,
      percent: Math.round(memPercent * 100) / 100,
      usageHuman: formatBytes(memUsage),
      limitHuman: formatBytes(memLimit),
    },
    network: {
      rxBytes: netRx,
      txBytes: netTx,
      rxHuman: formatBytes(netRx),
      txHuman: formatBytes(netTx),
    },
    blockIO: {
      readBytes: blkRead,
      writeBytes: blkWrite,
      readHuman: formatBytes(blkRead),
      writeHuman: formatBytes(blkWrite),
    },
    pids: stats.pids_stats?.current || 0,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Executes a command inside a container.
 * @param {string} containerId - Container ID or name
 * @param {Object} options - Exec options
 * @param {string} options.cmd - Command to execute
 * @param {boolean} [options.attachStdout=true] - Attach stdout
 * @param {boolean} [options.attachStderr=true] - Attach stderr
 * @returns {Promise<Object>}
 */
async function execInContainer(containerId, options) {
  const client = getDockerClient();
  if (!client) throw new Error('Docker client not available');

  const container = client.getContainer(containerId);
  const cmd = options.cmd || 'sh';
  const exec = await container.exec({
    Cmd: typeof cmd === 'string' ? cmd.split(/\s+/) : cmd,
    AttachStdout: options.attachStdout !== false,
    AttachStderr: options.attachStderr !== false,
    Tty: options.tty || false,
  });

  const stream = await exec.start({ Tty: options.tty || false, Detach: false });

  return new Promise((resolve, reject) => {
    let output = '';
    stream.on('data', (chunk) => {
      output += chunk.toString('utf8');
    });
    stream.on('end', () => {
      resolve({ id: containerId, output: output.trim() });
    });
    stream.on('error', reject);
  });
}

/**
 * Gets Docker system information.
 * @returns {Promise<Object>}
 */
async function getDockerInfo() {
  const client = getDockerClient();
  if (!client) throw new Error('Docker client not available');

  const info = await client.info();
  return {
    id: info.ID,
    name: info.Name,
    serverVersion: info.ServerVersion,
    os: info.OperatingSystem,
    kernel: info.KernelVersion,
    architecture: info.Architecture,
    containers: info.Containers,
    running: info.ContainersRunning,
    paused: info.ContainersPaused,
    stopped: info.ContainersStopped,
    images: info.Images,
    driver: info.Driver,
    memoryLimit: info.MemoryLimit,
    swapLimit: info.SwapLimit,
    cpuCount: info.NCPU,
    totalMemory: info.MemTotal,
    totalMemoryHuman: formatBytes(info.MemTotal),
    dockerRootDir: info.DockerRootDir,
    debug: info.DebugMode,
    plugins: info.Plugins?.Volume || [],
    labels: info.Labels || {},
    indexServerAddress: info.IndexServerAddress,
    registryConfig: info.RegistryConfig?.IndexConfigs
      ? Object.keys(info.RegistryConfig.IndexConfigs)
      : [],
    warnings: info.Warnings || [],
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatBytes(bytes) {
  if (bytes === 0 || !bytes) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// ─── Module Exports ───────────────────────────────────────────────────────────

module.exports = {
  detectDockerSocket,
  isRunningInContainer,
  createDockerClient,
  getDockerClient,
  testDockerConnection,
  listContainers,
  inspectContainer,
  startContainer,
  stopContainer,
  restartContainer,
  pauseContainer,
  unpauseContainer,
  getContainerLogs,
  getContainerStats,
  execInContainer,
  getDockerInfo,
  formatBytes,
};
