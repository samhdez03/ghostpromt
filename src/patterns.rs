use regex::Regex;
use once_cell::sync::Lazy;

pub struct PatternDef {
    pub name: &'static str,
    pub regex: &'static str,
}

pub fn global_patterns() -> Vec<PatternDef> {
    vec![
        PatternDef { name: "EMAIL", regex: r"\b[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}\b" },
        PatternDef { name: "PHONE", regex: r"(\+?\d{1,3}[\s\-.]?)?\(?\d{2,4}\)?[\s\-.]?\d{3,5}[\s\-.]?\d{4,6}" },
        PatternDef { name: "CREDIT_CARD", regex: r"\b(?:4[0-9]{12}(?:[0-9]{3})?|5[1-5][0-9]{14}|3[47][0-9]{13}|6(?:011|5[0-9]{2})[0-9]{12})\b" },
        PatternDef { name: "IP_V4", regex: r"\b(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\b" },
        PatternDef { name: "IP_V6", regex: r"\b(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}\b" },
        PatternDef { name: "PASSPORT", regex: r"\b[A-Z]{1,2}[0-9]{6,9}\b" },
        PatternDef { name: "IBAN", regex: r"\b[A-Z]{2}[0-9]{2}[A-Z0-9]{4}[0-9]{7}(?:[A-Z0-9]?){0,16}\b" },
        PatternDef { name: "SWIFT_BIC", regex: r"\b[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}(?:[A-Z0-9]{3})?\b" },
        PatternDef { name: "GPS_COORDS", regex: r"-?\d{1,3}\.\d{4,},\s*-?\d{1,3}\.\d{4,}" },
        PatternDef { name: "URL_WITH_TOKEN", regex: r"https?://[^\s]+[?&](?:token|key|api_key|access_token|secret|password)=[^\s&]+" },
        PatternDef { name: "API_KEY", regex: r#"(?i)(?:api[_\-]?key|token|secret|password|passwd|pwd)\s*[:=]\s*['"`]?([A-Za-z0-9\-_\.]{8,})"# },
        PatternDef { name: "CRYPTO_WALLET", regex: r"\b(?:bc1|[13])[a-zA-HJ-NP-Z0-9]{25,62}\b" },
        PatternDef { name: "MAC_ADDRESS", regex: r"\b(?:[0-9A-Fa-f]{2}[:\-]){5}[0-9A-Fa-f]{2}\b" },
        PatternDef { name: "CURP", regex: r"\b[A-Z][AEIOUX][A-Z]{2}\d{6}[HM][A-Z]{5}[A-Z0-9]{2}\b" },
        PatternDef { name: "RFC", regex: r"\b[A-Z&Ñ]{3,4}\d{6}[A-Z0-9]{3}\b" },
        PatternDef { name: "CLABE", regex: r"\b\d{18}\b" },
        PatternDef { name: "CPF_BR", regex: r"\b\d{3}\.\d{3}\.\d{3}-\d{2}\b" },
        PatternDef { name: "CNPJ_BR", regex: r"\b\d{2}\.\d{3}\.\d{3}/\d{4}-\d{2}\b" },
        PatternDef { name: "DNI_AR", regex: r"\b\d{2}\.\d{3}\.\d{3}\b" },
        PatternDef { name: "CUIL_AR", regex: r"\b(?:20|23|24|27|30|33|34)-\d{8}-\d\b" },
        PatternDef { name: "CEDULA_CO", regex: r"\b\d{8,10}\b" },
        PatternDef { name: "RUT_CL", regex: r"\b\d{7,8}-[0-9Kk]\b" },
        PatternDef { name: "DNI_PE", regex: r"\b\d{8}\b" },
        PatternDef { name: "SSN_US", regex: r"\b\d{3}-\d{2}-\d{4}\b" },
        PatternDef { name: "EIN_US", regex: r"\b\d{2}-\d{7}\b" },
        PatternDef { name: "ZIP_US", regex: r"\b\d{5}(?:-\d{4})?\b" },
        PatternDef { name: "SIN_CA", regex: r"\b\d{3}[\s\-]\d{3}[\s\-]\d{3}\b" },
        PatternDef { name: "NI_UK", regex: r"\b[A-CEGHJ-PR-TW-Z]{2}\d{6}[A-D]\b" },
        PatternDef { name: "DNI_ES", regex: r"\b\d{8}[A-Z]\b" },
        PatternDef { name: "NIE_ES", regex: r"\b[XYZ]\d{7}[A-Z]\b" },
        PatternDef { name: "NIF_ES", regex: r"\b[A-Z]\d{8}\b" },
        PatternDef { name: "INSEE_FR", regex: r"\b[12]\d{2}(0[1-9]|1[0-2])\d{2}\d{3}\d{3}\d{2}\b" },
        PatternDef { name: "STEUER_DE", regex: r"\b\d{2}/\d{3}/\d{5}\b" },
        PatternDef { name: "CF_IT", regex: r"\b[A-Z]{6}\d{2}[A-EHLMPRST]\d{2}[A-Z]\d{3}[A-Z]\b" },
        PatternDef { name: "BSN_NL", regex: r"\b\d{9}\b" },
        PatternDef { name: "PESEL_PL", regex: r"\b\d{11}\b" },
        PatternDef { name: "AADHAR_IN", regex: r"\b\d{4}[\s\-]\d{4}[\s\-]\d{4}\b" },
        PatternDef { name: "PAN_IN", regex: r"\b[A-Z]{5}\d{4}[A-Z]\b" },
        PatternDef { name: "NID_CN", regex: r"\b\d{17}[\dX]\b" },
        PatternDef { name: "TFN_AU", regex: r"\b\d{3}[\s\-]\d{3}[\s\-]\d{3}\b" },
        PatternDef { name: "NRIC_SG", regex: r"\b[STFG]\d{7}[A-Z]\b" },
        PatternDef { name: "JMBG_BA", regex: r"\b\d{13}\b" },
        PatternDef { name: "NATIONAL_ID_AE", regex: r"\b784-\d{4}-\d{7}-\d\b" },
        PatternDef { name: "ID_ZA", regex: r"\b\d{13}\b" },
        PatternDef { name: "NAME", regex: r"(?i)\b(?:mi\s+nombre\s+es\s+)?([a-záéíóúñ]+(?:\s+[a-záéíóúñ]+){1,2})\b" },
    ]
}

pub static GLOBAL_REGEXES: Lazy<Vec<(&'static str, Regex)>> = Lazy::new(|| {
    global_patterns()
        .into_iter()
        .map(|p| (p.name, Regex::new(p.regex).unwrap()))
        .collect()
});
