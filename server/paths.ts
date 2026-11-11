import path from 'path';

const configuredDataDir = process.env.APP_DATA_DIR?.trim();
export const APP_DATA_ROOT = path.resolve(configuredDataDir || process.cwd());
export const DATA_DIR = configuredDataDir ? APP_DATA_ROOT : path.join(APP_DATA_ROOT, 'data');
export const UPLOADS_DIR = path.join(APP_DATA_ROOT, 'uploads');
export const PROJECT_UPLOADS_DIR = path.join(UPLOADS_DIR, 'projects');
export const PREVIEWS_DIR = path.join(UPLOADS_DIR, 'previews');
export const LIVE_TEMP_DIR = path.join(UPLOADS_DIR, 'live_temp');