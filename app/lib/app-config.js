export const APP_NAME = "Muse Glimmer";
export const APP_VERSION = import.meta.env.VITE_APP_VERSION ?? "1.0.0";
export const APP_DESCRIPTION =
  "A local, optimized Muse Glimmer playground for Apple silicon.";
export const APP_STORAGE_PREFIX = "muse-glimmer";

export const THEME_STORAGE_KEY = `${APP_STORAGE_PREFIX}:theme`;
export const SESSION_STORAGE_KEY = `${APP_STORAGE_PREFIX}:session`;

export function formatPageTitle(title) {
  return title ? `${title} - ${APP_NAME}` : APP_NAME;
}
