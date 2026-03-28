import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import fr from "./locales/fr.json";
import en from "./locales/en.json";
import es from "./locales/es.json";
import de from "./locales/de.json";

const SUPPORTED = ["fr", "en", "es", "de"];

/**
 * Returns the language to use at startup:
 * 1. Saved in app settings (user's explicit choice)
 * 2. OS / browser language (first launch)
 * 3. English fallback
 */
function getInitialLanguage(): string {
  try {
    const stored = localStorage.getItem("vaultix_settings_v1");
    if (stored) {
      const lang: string = JSON.parse(stored).language ?? "";
      if (lang && SUPPORTED.includes(lang)) return lang;
    }
  } catch { /* ignore */ }

  // Fall back to OS / browser language (strip region: "fr-FR" → "fr")
  const nav = (navigator.language ?? "en").split("-")[0].toLowerCase();
  return SUPPORTED.includes(nav) ? nav : "en";
}

i18n
  .use(initReactI18next)
  .init({
    lng: getInitialLanguage(),
    resources: {
      fr: { translation: fr },
      en: { translation: en },
      es: { translation: es },
      de: { translation: de },
    },
    fallbackLng: "en",
    supportedLngs: SUPPORTED,
    interpolation: {
      escapeValue: false,
    },
  });

export default i18n;
