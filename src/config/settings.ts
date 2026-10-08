/** Defaults are empty — server URL + App-Token are set once in the Setup screen. */
export const DEFAULT_GLPI_URL = '';
export const GLPI_API_PATH = '/apirest.php';
export const DEFAULT_APP_TOKEN = '';

export const FEATURES = {
  cmms: true,
  fieldService: true,
  tenders: false,
  erp: false,
  aiAnalysis: false,
};

/**
 * Optional seed list if AssetDefinition API returns nothing.
 * system_name must match Setup → Asset definitions.
 */
export const ASSET_DEFINITION_TYPES: { label: string; system_name: string }[] = [
  { label: 'Hemodialysis Machine', system_name: 'HemodialysisMachines' },
  { label: 'Water Treatment', system_name: 'WaterTreatment' },
  { label: 'CT scanner', system_name: 'CTScanner' },
  { label: 'Medical Equipment', system_name: 'MedicalEquipment' },
  { label: 'ICU equipment', system_name: 'ICUEquipment' },
  { label: 'Biomedical And Mechanical Tools', system_name: 'BiomedicalAndMechanicalTools' },
];
