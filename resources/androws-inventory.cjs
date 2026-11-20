// Read only installation metadata, off the Electron main thread. Never start the Android engine.
const { DatabaseSync } = require('node:sqlite')
const { parentPort, workerData } = require('node:worker_threads')

/**
 * Read a consistent WAL-aware application inventory without copying or altering the source DB.
 * @param {string} filename Explicit InstalledApp.db path.
 * @returns {object[]} Bounded public installation metadata, including uninstall states.
 * @throws {Error} Missing schema, unreadable database or oversized inventory.
 */
function readInventory(filename) {
  const db = new DatabaseSync(filename, { readOnly: true })
  try {
    db.exec('PRAGMA query_only=ON; PRAGMA busy_timeout=1000; BEGIN')
    const rows = db
      .prepare('SELECT package_name,name,version_name,engine_name,state,icon FROM apps LIMIT 5001')
      .all()
    if (rows.length > 5000) throw Error('Application inventory exceeds supported limit')
    db.exec('COMMIT')
    return rows
  } finally {
    db.close()
  }
}
module.exports = { readInventory }
if (parentPort) {
  try {
    parentPort.postMessage({ rows: readInventory(workerData.filename) })
  } catch {
    parentPort.postMessage({ error: 'Application inventory unavailable' })
  }
}
