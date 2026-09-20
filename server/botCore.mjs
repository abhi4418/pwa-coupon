// Port of desktop-app-v2/bot_core.py constants + validators.
// Desktop files are NOT imported or modified — this is a standalone copy
// for the Vercel/Node backend so behaviour matches 1:1.
export const CLAIM_URL = "https://pgretailpromo.woohoo.in/claimreward";

export const LOCATORS = {
  phone: "/html/body/div[3]/main/div/div[1]/div/div[4]/form/div[1]/div/div[1]/div/div[1]/input",
  coupon: "/html/body/div[3]/main/div/div[1]/div/div[4]/form/div[1]/div/div[1]/div/div[2]/input",
  state: "/html/body/div[3]/main/div/div[1]/div/div[4]/form/div[1]/div/div[1]/div/div[3]/select",
  terms: "/html/body/div[3]/main/div/div[1]/div/div[4]/form/div[1]/div/div[1]/div/div[4]/div/input",
  submit: "/html/body/div[3]/main/div/div[1]/div/div[4]/form/div[1]/div/div[1]/div/div[5]/input",
  otp_next: "/html/body/div[3]/main/div/div[1]/div/div[4]/form/div[3]/div/div[1]/div/div[3]/input",
  upi_option: "/html/body/div[3]/main/div/div[1]/div/div[4]/form/div[3]/div/div[1]/div/div[1]/div/div/div/div/div/img",
  upi_id: "/html/body/div[3]/main/div/div[1]/div/div[4]/form/div[3]/div/div[1]/div/div[2]/div/div/div[1]/div/input",
  upi_terms: "/html/body/div[3]/main/div/div[1]/div/div[4]/form/div[3]/div/div[1]/div/div[2]/div/div/div[2]/div/div/input",
  final_submit: "/html/body/div[3]/main/div/div[1]/div/div[4]/form/div[3]/div/div[1]/div/div[3]/input",
};

export const STATES = [
  "ANDAMAN AND NICOBAR ISLANDS", "ANDHRA PRADESH", "ARUNACHAL PRADESH",
  "ASSAM", "BIHAR", "CHANDIGARH", "CHHATTISGARH",
  "DADRA AND NAGAR HAVELI AND DAMAN AND DIU", "DELHI", "GOA",
  "GUJARAT", "HARYANA", "HIMACHAL PRADESH", "JAMMU AND KASHMIR",
  "JHARKHAND", "KARNATAKA", "KERALA", "LADAKH", "LAKSHADWEEP",
  "MADHYA PRADESH", "MAHARASHTRA", "MANIPUR", "MEGHALAYA", "MIZORAM",
  "NAGALAND", "ODISHA", "PUDUCHERRY", "PUNJAB", "RAJASTHAN", "SIKKIM",
  "TAMIL NADU", "TELANGANA", "TRIPURA", "UTTAR PRADESH",
  "UTTARAKHAND", "WEST BENGAL",
];

const PHONE_RE = /^[6-9]\d{9}$/;
const UPI_RE = /^[\w.\-]{2,}@[a-zA-Z]{2,}$/;

export const validPhone = (s) => PHONE_RE.test(String(s || "").trim());
export const validUpi = (s) => UPI_RE.test(String(s || "").trim());

export function parseCodes(text) {
  text = text || "";
  const m = text.match(/\[[\s\S]*?\]/);
  if (m) {
    try {
      const arr = JSON.parse(m[0]);
      const out = arr
        .map((x) => String(x).replace(/[\s\-]/g, "").toUpperCase())
        .filter(Boolean);
      if (out.length) return [...new Set(out)];
    } catch { /* fall through to token scan */ }
  }
  return [...new Set((text.toUpperCase().match(/[A-Z0-9]{8,}/g) || []))];
}

// Same rejection phrases as bot_core.py ERROR_RE (kept in sync manually).
export const ERROR_RE = new RegExp(
  "already\\s+(redeem(?:ed)?|claim(?:ed)?|used|registered|applied|availed)" +
  "|(?:coupon|code|voucher|promo|offer).{0,60}" +
  "(?:already|invalid|incorrect|wrong|expired|used|duplicate|" +
  "not\\s+valid|not\\s+found|fail(?:ed)?|error|limit|exhaust|blocked)" +
  "|(?:invalid|incorrect|wrong|expired|duplicate)\\s+" +
  "(?:coupon|code|voucher|promo|otp)" +
  "|redemption\\s+fail",
  "i"
);

export const MODAL_JS = `() => {
  const sels = ['[role="dialog"]','[role="alertdialog"]','.modal',
   '.modal-dialog','.modal-content','.modal-body',
   '.swal2-popup','.swal2-html-container','.swal2-title',
   '.toast','.toast-body','.alert','.MuiDialog-root','.MuiAlert-root',
   '.ant-modal','.ant-message','.p-dialog',
   '[class*="toast" i]','[class*="modal" i]','[class*="alert" i]',
   '[class*="popup" i]','[class*="error" i]','[class*="swal" i]'];
  const out = [];
  try {
    for (const s of sels) {
      let els = [];
      try { els = document.querySelectorAll(s); } catch(e) { continue; }
      for (const el of els) {
        try {
          const r = el.getBoundingClientRect();
          if (r.width < 2 && r.height < 2) continue;
          const st = window.getComputedStyle(el);
          if (st.display === 'none' || st.visibility === 'hidden'
              || parseFloat(st.opacity || '1') < 0.05) continue;
          const t = (el.innerText || el.textContent || '').trim();
          if (t && t.length > 1) out.push(t.slice(0, 500));
        } catch(e) {}
      }
    }
  } catch(e) {}
  let body = '';
  try { body = (document.body ? document.body.innerText : '').slice(0, 4000); }
  catch(e) {}
  return {modals: out.slice(0, 12), body: body || ''};
}`;
