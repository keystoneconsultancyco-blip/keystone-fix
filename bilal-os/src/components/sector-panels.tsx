// Optional custom panels shown on a sector's Overview tab.
// Add one by exporting an async server component and mapping it to the sector id.
export const SECTOR_PANELS: Record<string, (p: { sectorId: string }) => Promise<React.ReactNode>> = {};
