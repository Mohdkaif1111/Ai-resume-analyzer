/* app.js
   Browser-only resume analyzer.
   Uses:
     - PDF.js
     - Mammoth
     - Tesseract.js (OCR)
*/

// -------------------- Config & Trending Skills --------------------
const TRENDING_SKILLS = [
  "python","javascript","typescript","react","node.js","node","express","django","flask",
  "sql","postgresql","mysql","mongodb","aws","azure","gcp","docker","kubernetes",
  "machine learning","deep learning","tensorflow","pytorch","nlp","computer vision",
  "power bi","tableau","excel","data analysis","pandas","numpy","scikit-learn",
  "html","css","rest api","graphql","git","github","ci/cd","selenium","automation"
];

const WEIGHTS = {
  contact: 25,
  skills: 40,
  experience: 20,
  length: 10,
  extras: 5
};

// -------------------- Helpers --------------------
function sanitizeText(t){
  return (t || "").replace(/\r/g," ").replace(/\n+/g,"\n").replace(/\t/g," ").trim();
}
function findEmails(text){ return Array.from(new Set((text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[A-Za-z]{2,}/g) || []))); }
function findPhones(text){ return Array.from(new Set((text.match(/(\+?\d{2,3}[\s-]?)?\d{10}|\b\d{3}[-.\s]\d{3}[-.\s]\d{4}\b/g) || []))); }
function findLinkedIn(text){ const m = text.match(/linkedin\.com\/[^\s/]+\/?[^\s]*/i); return m ? [m[0]] : []; }
function extractYears(text){
  let years = 0;
  const m = text.match(/(\d+)\s+years?/i);
  if(m) years = Math.min(30, parseInt(m[1],10));
  else {
    const yrs = text.match(/\b(19|20)\d{2}\b/g);
    if(yrs && yrs.length >= 2){
      const nums = yrs.map(x=>parseInt(x,10)).sort();
      years = Math.max(0, nums[nums.length-1] - nums[0]);
      if(years > 50) years = Math.floor(years/2);
    }
  }
  return years;
}
function scoreLength(text){
  const words = (text || "").split(/\s+/).filter(Boolean).length;
  if(words < 100) return 0;
  if(words < 300) return 6;
  if(words < 700) return 9;
  return 10;
}
function computeSkills(text){
  const lower = text.toLowerCase();
  const matched = [];
  TRENDING_SKILLS.forEach(skill => {
    const s = skill.replace(/\./g, "\\.").replace(/\s+/g, "\\s+");
    try{ if(new RegExp(`\\b${s}\\b`, "i").test(lower)) matched.push(skill); }
    catch(e){ if(lower.includes(skill)) matched.push(skill); }
  });
  const percent = Math.min(100, Math.round((matched.length / TRENDING_SKILLS.length) * 100));
  return {matched, percent};
}
function computeScore(parsedText){
  const text = sanitizeText(parsedText || "");
  const emails = findEmails(text);
  const phones = findPhones(text);
  const linkedin = findLinkedIn(text);
  const contactScore = (emails.length>0 || phones.length>0 || linkedin.length>0) ? WEIGHTS.contact : 0;

  const years = extractYears(text);
  const expScore = Math.min(WEIGHTS.experience, Math.round((years / 10) * WEIGHTS.experience));

  const lenScore = scoreLength(text);

  const skills = computeSkills(text);
  const skillsScore = Math.round((skills.percent/100) * WEIGHTS.skills);

  const extras = (/(education|projects|certificat|awards|publications)/i.test(text)) ? WEIGHTS.extras : 0;

  const raw = contactScore + expScore + lenScore + skillsScore + extras;
  const final = Math.min(100, Math.round(raw));
  return { final, breakdown:{contactScore,expScore,lenScore,skillsScore,extras, matched:skills.matched, skillsPercent:skills.percent, emails, phones, linkedin, years} };
}

// -------------------- Parsing --------------------
async function parsePDF(file){
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({data: arrayBuffer}).promise;
  let fullText = "";
  for(let p=1; p<=pdf.numPages; p++){
    try{
      const page = await pdf.getPage(p);
      const content = await page.getTextContent();
      const strings = content.items.map(i => i.str);
      fullText += strings.join(" ") + "\n\n";
    } catch(e){ console.warn("page parse err", e); }
  }
  // if empty, attempt OCR
  if(!fullText.trim() && file.type==="application/pdf"){
    try{
      const img = await file.arrayBuffer();
      const worker = Tesseract.createWorker();
      await worker.load(); await worker.loadLanguage('eng'); await worker.initialize('eng');
      const {data:{text}} = await worker.recognize(new Uint8Array(img));
      await worker.terminate();
      return sanitizeText(text);
    } catch(e){ console.warn("OCR failed", e); }
  }
  return sanitizeText(fullText);
}

async function parseDocx(file){ 
  const arrayBuffer = await file.arrayBuffer();
  const result = await mammoth.extractRawText({arrayBuffer});
  return sanitizeText(result.value || "");
}
async function parseGeneric(file){ 
  const text = await file.text();
  try{ return sanitizeText(JSON.stringify(JSON.parse(text), null, 2)); }
  catch(e){ return sanitizeText(text); }
}
async function parseFile(file){
  const name = (file.name || "").toLowerCase();
  if(name.endsWith(".pdf")) return await parsePDF(file);
  if(name.endsWith(".docx")) return await parseDocx(file);
  if(name.endsWith(".json") || name.endsWith(".txt")) return await parseGeneric(file);
  const type = file.type || "";
  if(type.includes("pdf")) return await parsePDF(file);
  if(type.includes("officedocument") || name.endsWith(".doc")) return await parseDocx(file);
  return await parseGeneric(file);
}

// -------------------- UI --------------------
const fileInput = document.getElementById("fileInput");
const fileDrop = document.getElementById("fileDrop");
const analyzeBtn = document.getElementById("analyzeBtn");
const clearBtn = document.getElementById("clearBtn");
const resultArea = document.getElementById("resultArea");
const parsedTextEl = document.getElementById("parsedText");
const scoreValueEl = document.getElementById("scoreValue");
const scoreDescEl = document.getElementById("scoreDesc");
const progressFill = document.getElementById("progressFill");
const basicsList = document.getElementById("basicsList");
const skillsCloud = document.getElementById("skillsCloud");
const suggestionList = document.getElementById("suggestionList");
const downloadReport = document.getElementById("downloadReport");
const copyText = document.getElementById("copyText");
const summaryText = document.getElementById("summaryText");
const fileLabelText = document.getElementById("fileLabelText");

let CURRENT_PARSED = "";

// File Drop
fileDrop.addEventListener("dragover", e=>{ e.preventDefault(); fileDrop.style.borderColor="rgba(59,160,255,0.6)"; });
fileDrop.addEventListener("dragleave", ()=>{ fileDrop.style.borderColor=""; });
fileDrop.addEventListener("drop", e=>{
  e.preventDefault();
  const f = e.dataTransfer.files[0];
  if(f){ fileInput.files = e.dataTransfer.files; fileLabelText.querySelector('strong').textContent = f.name; fileLabelText.querySelector('strong').classList.add('uploaded-file'); }
});

// File selected
fileInput.addEventListener("change", ()=>{
  if(fileInput.files[0]) fileLabelText.querySelector('strong').textContent = fileInput.files[0].name;
});

// Clear
clearBtn.addEventListener("click", ()=>{
  fileInput.value = "";
  resultArea.classList.add("hidden");
  parsedTextEl.textContent = "";
  CURRENT_PARSED = "";
  scoreValueEl.textContent = "--";
  progressFill.style.width = "0%";
  basicsList.innerHTML = "";
  skillsCloud.innerHTML = "";
  suggestionList.innerHTML = "";
  summaryText.textContent = "—";
  fileLabelText.querySelector('strong').textContent = "Drop or select a file";
});

// Analyze
analyzeBtn.addEventListener("click", async ()=>{
  const file = fileInput.files && fileInput.files[0];
  if(!file){ alert("Please choose a file first."); return; }
  analyzeBtn.disabled = true; analyzeBtn.textContent = "Analyzing...";
  try{
    const parsed = await parseFile(file);
    CURRENT_PARSED = parsed;
    parsedTextEl.textContent = parsed || "[No text extracted — maybe scanned PDF?]";
    const result = computeScore(parsed);

    basicsList.innerHTML="";
    const addLi=(k,v)=> basicsList.insertAdjacentHTML("beforeend", `<li><strong>${k}:</strong> <span class="muted"> ${v || '—'}</span></li>`);
    addLi("File", file.name);
    addLi("Emails", result.breakdown.emails.join(", ") || "Not found");
    addLi("Phones", result.breakdown.phones.join(", ") || "Not found");
    addLi("LinkedIn", result.breakdown.linkedin.join(", ") || "Not found");
    addLi("Estimated years", result.breakdown.years || "—");

    scoreValueEl.textContent = result.final+"/100";
    scoreDescEl.textContent = result.final>=75 ? "Strong" : result.final>=50 ? "Average" : "Needs improvement";
    progressFill.style.width=`${result.final}%`;

    skillsCloud.innerHTML="";
    result.breakdown.matched.forEach(s=>{
      const el = document.createElement("span"); el.className="skillTag matched"; el.textContent=s; skillsCloud.appendChild(el);
    });
    const remaining = TRENDING_SKILLS.filter(s=>!result.breakdown.matched.includes(s)).slice(0,12);
    remaining.forEach(s=>{
      const el = document.createElement("span"); el.className="skillTag"; el.textContent=s; skillsCloud.appendChild(el);
    });

    // Suggestions
    const suggestions = [];
    if(result.breakdown.emails.length===0) suggestions.push("Add a professional email address (example: name@domain.com).");
    if(result.breakdown.phones.length===0) suggestions.push("Include a phone number for quick contact.");
    if(result.breakdown.years<1) suggestions.push("Add internships/projects with dates to show experience.");
    if(result.breakdown.matched.length===0) suggestions.push("Include relevant technologies/skills—use keywords from the job posting.");
    if(result.final<50) suggestions.push("Shorten or restructure: start with a strong summary and highlights (skills, top achievements).");
    if(result.final>=75) suggestions.push("Great! Consider adding performance numbers (metrics) to strengthen credibility.");

    suggestionList.innerHTML = suggestions.length>0 
      ? suggestions.map(s=>`<li>${s}</li>`).join("")
      : "<li>No suggestions needed — looks good!</li>";   // ✅ Fixed here

    summaryText.textContent = `Matched ${result.breakdown.matched.length} trending skills · Skills match ${result.breakdown.skillsPercent}% · Estimated ${result.breakdown.years} years`;

    resultArea.classList.remove("hidden");
  } catch(err){ console.error(err); alert("Error parsing file."); }
  finally{ analyzeBtn.disabled=false; analyzeBtn.textContent="Analyze Resume"; }
});

// Copy parsed text
copyText.addEventListener("click", ()=>{
  if(!CURRENT_PARSED) return alert("No parsed text to copy.");
  navigator.clipboard.writeText(CURRENT_PARSED).then(()=> alert("Parsed text copied to clipboard."));
});

// Download report
downloadReport.addEventListener("click", ()=>{
  if(!CURRENT_PARSED) return alert("Analyze a resume first.");
  const report = {
    generatedAt: new Date().toISOString(),
    parsedText: CURRENT_PARSED,
    summary: scoreValueEl.textContent,
    basics: Array.from(basicsList.querySelectorAll("li")).map(li=>li.textContent)
  };
  const blob = new Blob([JSON.stringify(report,null,2)],{type:"application/json"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href=url; a.download="resume_report.json"; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
});
