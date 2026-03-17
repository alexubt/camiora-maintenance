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
  },
  scanPages:    [],   // Blob[] — processed JPEG blobs, NOT canvas objects
  activeUnitId: null,
  isUploading:  false,
};
