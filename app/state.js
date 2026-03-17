/**
 * Shared in-memory state singleton.
 * Native ES module — import { state } from './state.js'
 */

export const state = {
  token:        null,
  tokenExp:     0,
  fleet: {
    units:      [],
    unitsHash:  null,
    unitsPath:  'Fleet Maintenance/data/units.csv',
  },
  scanPages:    [],
  activeUnitId: null,
  isUploading:  false,
};
