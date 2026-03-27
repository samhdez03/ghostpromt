use wasm_bindgen::prelude::*;
use std::collections::HashMap;
use serde::{Deserialize, Serialize};
use blake2::{Blake2b, Digest};
use blake2::digest::consts::U6;
use unicode_normalization::UnicodeNormalization;

mod patterns;
use patterns::GLOBAL_REGEXES;

type Blake2b48 = Blake2b<U6>;

fn normalize_value(kind: &str, value: &str) -> String {
    let trimmed = value.trim();
    match kind {
        "EMAIL" | "URL_WITH_TOKEN" => trimmed.to_lowercase(),
        "PHONE" => {
            let mut digits: String = trimmed.chars().filter(|c| c.is_ascii_digit()).collect();
            if digits.starts_with("00") { digits = digits[2..].to_string(); }
            if digits.len() == 11 && digits.starts_with('1') { digits = digits[1..].to_string(); }
            if digits.len() == 12 && digits.starts_with("52") { digits = digits[2..].to_string(); }
            digits
        },
        "NAME" => {
            let no_marks: String = trimmed
                .nfkd()
                .filter(|c| !matches!(*c, '\u{0300}'..='\u{036f}'))
                .collect();
            no_marks
                .split_whitespace()
                .collect::<Vec<_>>()
                .join(" ")
                .to_lowercase()
        }
        _ => trimmed.split_whitespace().collect::<String>().to_uppercase(),
    }
}

fn make_token(label: &str, value: &str, session_key: &[u8; 32]) -> String {
    let mut h = Blake2b48::new();
    h.update(session_key);
    h.update(label.as_bytes());
    h.update(value.as_bytes());
    let digest = h.finalize();
    format!("[[GP_{}_{:}]]", label, hex::encode(digest))
}

#[derive(Serialize, Deserialize)]
pub struct Entry {
    pub token: String,
    pub kind: String,
    pub value: String,
}

#[derive(Serialize, Deserialize)]
pub struct AnonResult {
    pub anonymized_text: String,
    pub token_count: usize,
    pub detected: Vec<Entry>,
}

#[wasm_bindgen]
pub struct GhostSession {
    forward_map: HashMap<String, String>,
    reverse_map: HashMap<String, String>,
    session_key: [u8; 32],
}

#[wasm_bindgen]
impl GhostSession {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        let mut key = [0u8; 32];
        getrandom::getrandom(&mut key).expect("getrandom failed");
        Self {
            forward_map: HashMap::new(),
            reverse_map: HashMap::new(),
            session_key: key,
        }
    }

    pub fn anonymize(&mut self, text: &str) -> String {
        let mut result = text.to_string();
        let mut detected = Vec::new();

        for (kind, pattern) in GLOBAL_REGEXES.iter() {
            let matches: Vec<String> = pattern.find_iter(&result).map(|m| m.as_str().to_string()).collect();
            for raw in matches {
                let normalized = normalize_value(kind, &raw);
                let forward_key = format!("{}:{}", kind, normalized);
                let token = self.forward_map.entry(forward_key).or_insert_with(|| {
                    let hash_input = if *kind == "NAME" { normalized.clone() } else { format!("{}:{}", kind, normalized) };
                    let t = make_token(kind, &hash_input, &self.session_key);
                    self.reverse_map.insert(t.clone(), raw.clone());
                    t
                }).clone();
                result = result.replace(&raw, &token);
                detected.push(Entry { token, kind: (*kind).to_string(), value: raw });
            }
        }

        serde_json::to_string(&AnonResult {
            anonymized_text: result,
            token_count: self.reverse_map.len(),
            detected,
        }).unwrap_or_default()
    }

    pub fn rehydrate(&self, text: &str) -> String {
        let mut result = text.to_string();
        let mut pairs: Vec<(&String, &String)> = self.reverse_map.iter().collect();
        pairs.sort_by(|a, b| b.0.len().cmp(&a.0.len()));
        for (token, value) in pairs {
            result = result.replace(token.as_str(), value.as_str());
        }
        result
    }

    pub fn clear(&mut self) {
        self.forward_map.clear();
        self.reverse_map.clear();
        getrandom::getrandom(&mut self.session_key).expect("getrandom failed");
    }
}
