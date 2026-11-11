/**
 * Change only one NTFS volume row, preserving all other INI bytes and settings.
 * @param {string} text Existing Everything settings.
 * @param {string} drive Drive letter such as F:.
 * @param {string} guid Actual Windows volume GUID path.
 * @returns {string} Updated settings text.
 */
function includeVolume(text, drive, guid) {
  if (!/^[A-Z]:$/i.test(drive) || !/^\\\\\?\\Volume\{[a-f0-9-]+\}\\?$/i.test(guid))
    throw new Error('Invalid volume identity')
  const keys = {
    ntfs_volume_guids: JSON.stringify(guid.replace(/\\$/, '')),
    ntfs_volume_paths: JSON.stringify(drive.toUpperCase()),
    ntfs_volume_roots: '""',
    ntfs_volume_includes: '1',
    ntfs_volume_load_recent_changes: '0',
    ntfs_volume_include_onlys: '""',
    ntfs_volume_monitors: '1'
  }
  const rows = {}
  for (const key of Object.keys(keys)) {
    const value = new RegExp('^' + key + '=([^\\r\\n]*)', 'm').exec(text)?.[1]
    if (value === undefined) throw new Error('Missing volume row: ' + key)
    rows[key] = value.match(/"(?:\\.|[^"\\])*"|[^,]+/g) || []
  }
  const paths = rows.ntfs_volume_paths.map((value) => JSON.parse(value).toUpperCase())
  if (Object.values(rows).some((row) => row.length !== paths.length))
    throw new Error('Unaligned volume settings')
  const index = paths.indexOf(drive.toUpperCase())
  for (const [key, value] of Object.entries(keys)) {
    if (index < 0) rows[key].push(value)
    else if (key === 'ntfs_volume_guids' || key === 'ntfs_volume_includes') rows[key][index] = value
    text = text.replace(
      new RegExp('^' + key + '=[^\\r\\n]*', 'm'),
      () => key + '=' + rows[key].join(',')
    )
  }
  return text
}
module.exports = { includeVolume }
