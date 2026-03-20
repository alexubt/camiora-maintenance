/**
 * Shared in-memory state singleton.
 * Native ES module — import { state } from './state.js'
 */

export const state = {
  token:        null,
  tokenExp:     0,
  fleet: {
    units:         [],
    unitsHash:     null,
    unitsPath:     'Fleet Maintenance/data/units.csv',
    invoices:      [],           // not loaded at boot — only written to
    invoicesHash:  null,
    invoicesPath:  'Fleet Maintenance/data/invoices.csv',
    maintenance:      [],
    maintenancePath:  'Fleet Maintenance/data/maintenance.csv',
    maintenanceHash:  null,
    condition:        [],
    conditionPath:    'Fleet Maintenance/data/condition.csv',
    conditionHash:    null,
    milestoneConfig:      [],   // parsed rows from milestone-config.csv
    milestoneConfigPath:  'Fleet Maintenance/data/milestone-config.csv',
    milestoneConfigHash:  null,
    samsaraMappingPath:   'Fleet Maintenance/data/samsara-mapping.csv',
  },
  samsara: {
    mapping:           new Map(),  // UnitId → SamsaraVehicleId
    locations:         {},         // UnitId → { location, heading, speed, lat, lng }
    enabled:           false,      // true once mapping CSV is found and non-empty
    lastSynced:        0,          // timestamp ms, 0 = never
    lastError:         null,       // string | null
    consecutiveErrors: 0,
    syncStatus:        'idle',     // 'idle'|'syncing'|'ok'|'error'|'no-mapping'
  },
  scanPages:    [],   // Blob[] — processed JPEG blobs, NOT canvas objects
  activeUnitId: null,
  isUploading:  false,
};
