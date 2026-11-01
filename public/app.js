const $ = (s) => document.querySelector(s);

const STYLES = {
  none:       { label: "None",        add: "" },
  realistic:  { label: "Photo",       add: ", photorealistic, natural light, sharp focus" },
  anime:      { label: "Anime",       add: ", anime style, vibrant colors, clean line art" },
  oil:        { label: "Oil paint",   add: ", oil painting, visible brush strokes, rich texture" },
  watercolor: { label: "Watercolor",  add: ", watercolor painting, soft washes, paper texture" },
  pixel:      { label: "Pixel art",   add: ", pixel art, 16-bit, limited palette" },
  render3d:   { label: "3D render",   add: ", 3D render, soft studio lighting, detailed" },
  cyberpunk:  { label: "Cyberpunk",   add: ", cyberpunk, neon lights, rainy night, cinematic" },
};
const RATIOS = {
  square:    { label: "Square",    w: 1024, h: 1024, box: [14, 14] },
  portrait:  { label: "Portrait",  w: 768,  h: 1024, box: [11, 16] },
  landscape: { label: "Landscape", w: 1024, h: 768,  box: [18, 13] },
};
const IDEAS = [
  "A lighthouse on a cliff at dawn, fog rolling in",
  "A tiny astronaut tending a rooftop garden in the rain",
  "A street market in Lahore at night, lanterns and steam",
  "A glass whale floating over a quiet desert",
  "A cozy library inside a giant old tree",
  "A paper boat crossing a puddle that reflects a galaxy",
  "A red train crossing snowy mountains at sunrise",
];

const slug = (t) => t.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "image";

async function download(url, name) {
  try {
    const blob = await (await fetch(url)).blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name + ".jpg";
    a.click();
    URL.revokeObjectURL(a.href);
  } catch { window.open(url, "_blank"); }
}

/* ===================== FULL-SIZE VIEWER ===================== */
let lb, lbList = [], lbIndex = 0, lbReturnFocus = null;

function lbShow() {
  const it = lbList[lbIndex];
  const img = lb.querySelector("img");
  img.alt = it.prompt;
  img.src = it.url;
  lb.querySelector("figcaption").textContent = it.prompt;
  const many = lbList.length > 1;
  lb.querySelector(".lb-prev").hidden = !many;
  lb.querySelector(".lb-next").hidden = !many;
}
function lbStep(d) {
  if (lbList.length < 2) return;
  lbIndex = (lbIndex + d + lbList.length) % lbList.length;
  lbShow();
}
function lbClose() {
  if (!lb || lb.hidden) return;
  lb.hidden = true;
  document.body.style.overflow = "";
  if (lbReturnFocus) lbReturnFocus.focus();
}
function openLightbox(list, index) {
  if (!lb) {
    lb = document.createElement("div");
    lb.className = "lightbox";
    lb.hidden = true;
    lb.setAttribute("role", "dialog");
    lb.setAttribute("aria-modal", "true");
    lb.setAttribute("aria-label", "Image viewer");
    lb.innerHTML = `<button class="lb-close" aria-label="Close">&times;</button>
      <button class="lb-nav lb-prev" aria-label="Previous image">&#8249;</button>
      <figure><img alt=""><figcaption></figcaption>
        <div class="lb-actions"><button class="small lb-dl">Download</button></div></figure>
      <button class="lb-nav lb-next" aria-label="Next image">&#8250;</button>`;
    document.body.appendChild(lb);
    lb.addEventListener("click", (e) => { if (e.target === lb) lbClose(); });
    lb.querySelector(".lb-close").onclick = lbClose;
    lb.querySelector(".lb-prev").onclick = () => lbStep(-1);
    lb.querySelector(".lb-next").onclick = () => lbStep(1);
    lb.querySelector(".lb-dl").onclick = () => { const it = lbList[lbIndex]; download(it.url, slug(it.prompt)); };
    lb.querySelector("img").onerror = () => { lb.querySelector("figcaption").textContent = "This image is no longer available."; };
    document.addEventListener("keydown", (e) => {
      if (lb.hidden) return;
      if (e.key === "Escape") lbClose();
      else if (e.key === "ArrowLeft") lbStep(-1);
      else if (e.key === "ArrowRight") lbStep(1);
    });
  }
  lbList = list;
  lbIndex = index;
  lbReturnFocus = document.activeElement;
  lbShow();
  lb.hidden = false;
  document.body.style.overflow = "hidden";
  lb.querySelector(".lb-close").focus();
}

/* ===================== CREATE PAGE ===================== */
function initCreate() {
  const frame = $("#frame");
  let current = null;

  $("#styles").innerHTML = Object.entries(STYLES).map(([k, s], i) =>
    `<label><input type="radio" name="style" value="${k}" ${i === 0 ? "checked" : ""}><span>${s.label}</span></label>`).join("");
  $("#ratios").innerHTML = Object.entries(RATIOS).map(([k, r], i) =>
    `<label><input type="radio" name="ratio" value="${k}" ${i === 0 ? "checked" : ""}><span><i style="width:${r.box[0]}px;height:${r.box[1]}px"></i>${r.label}</span></label>`).join("");

  const val = (name) => document.querySelector(`input[name=${name}]:checked`).value;
  const setMsg = (t, err) => { const m = $("#msg"); m.textContent = t || ""; m.className = err ? "err" : ""; };
  const setFrameRatio = (r) => { frame.className = "frame r-" + r; };

  $("#ratios").addEventListener("change", () => { if (!current) setFrameRatio(val("ratio")); });
  $("#surprise").addEventListener("click", () => {
    $("#prompt").value = IDEAS[Math.floor(Math.random() * IDEAS.length)];
    $("#prompt").focus();
  });

  // settings sent over from the "Reuse" button on My images
  try {
    const raw = sessionStorage.getItem("reuse");
    if (raw) {
      sessionStorage.removeItem("reuse");
      const it = JSON.parse(raw);
      $("#prompt").value = it.prompt || "";
      $("#seed").value = it.seed ?? "";
      const s = document.querySelector(`input[name=style][value="${it.style}"]`); if (s) s.checked = true;
      const r = document.querySelector(`input[name=ratio][value="${it.ratio}"]`); if (r) { r.checked = true; setFrameRatio(it.ratio); }
    }
  } catch {}

  $("#form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const prompt = $("#prompt").value.trim();
    if (!prompt) return setMsg("Write a description first.", true);

    const style = val("style"), ratio = val("ratio"), r = RATIOS[ratio];
    const seed = $("#seed").value !== "" ? Number($("#seed").value) : Math.floor(Math.random() * 1000000);

    setFrameRatio(ratio);
    frame.classList.add("loading");
    $("#go").disabled = true;
    $("#resultBar").classList.add("off");
    setMsg("Generating… this can take 10–40 seconds.");

    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, fullPrompt: prompt + STYLES[style].add, style, ratio, seed, width: r.w, height: r.h }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Generation failed.");

      const img = new Image();
      img.alt = prompt;
      await new Promise((ok, bad) => { img.onload = ok; img.onerror = () => bad(new Error("Image could not be loaded.")); img.src = data.url; });
      frame.innerHTML = "";
      img.title = "Click to view full size";
      img.onclick = () => openLightbox([{ url: data.url, prompt }], 0);
      frame.appendChild(img);
      current = { url: data.url, filename: slug(prompt) };
      $("#resultMeta").textContent = `Seed ${seed} · click the image to view it full size`;
      $("#resultBar").classList.remove("off");
      setMsg("Done. Saved to My images.");
    } catch (err) {
      setMsg(err.message, true);
    } finally {
      frame.classList.remove("loading");
      $("#go").disabled = false;
    }
  });

  $("#resultDownload").addEventListener("click", () => current && download(current.url, current.filename));
}

/* ===================== MY IMAGES PAGE ===================== */
function initGallery() {
  async function loadGallery() {
    const q = $("#search").value.trim();
    const fav = $("#favOnly").checked ? "1" : "0";
    const grid = $("#grid");
    try {
      const res = await fetch(`/api/images?q=${encodeURIComponent(q)}&fav=${fav}`);
      const items = await res.json();
      if (!Array.isArray(items)) throw new Error();
      $("#count").textContent = items.length === 1 ? "1 image" : `${items.length} images`;
      if (!items.length) {
        grid.innerHTML = `<p class="none">${q || fav === "1" ? "No images match." : "Nothing saved yet. Go to Create to make your first image."}</p>`;
        return;
      }
      grid.innerHTML = "";
      items.forEach((it, i) => grid.appendChild(card(it, i, items)));
    } catch {
      $("#count").textContent = "";
      grid.innerHTML = `<p class="none">Couldn't load your images. Is the server running?</p>`;
    }
  }

  function card(it, idx, list) {
    const el = document.createElement("article");
    el.className = "card";
    el.innerHTML = `<img loading="lazy" alt=""><p class="cap"></p><div class="meta"></div>
      <div class="acts">
        <button class="small fav"></button>
        <button class="small dl">Download</button>
        <button class="small reuse">Reuse</button>
        <button class="small danger del">Delete</button>
      </div>`;
    const pic = el.querySelector("img");
    pic.alt = it.prompt;
    pic.onerror = () => {
      const ph = document.createElement("div");
      ph.className = "broken";
      ph.innerHTML = "<strong>Image unavailable</strong><small>Press Reuse, then Generate image to make it again.</small>";
      pic.replaceWith(ph);
    };
    pic.src = it.url;
    pic.title = "Click to view full size";
    pic.tabIndex = 0;
    const open = () => openLightbox(list.map((x) => ({ url: x.url, prompt: x.prompt })), idx);
    pic.onclick = open;
    pic.onkeydown = (e) => { if (e.key === "Enter") open(); };
    el.querySelector(".cap").textContent = it.prompt;
    el.querySelector(".meta").textContent = `${STYLES[it.style]?.label || "None"} · ${RATIOS[it.ratio]?.label || ""} · seed ${it.seed}`;

    const fav = el.querySelector(".fav");
    const paint = () => { fav.textContent = it.favorite ? "Favorited" : "Favorite"; fav.classList.toggle("on", it.favorite); };
    paint();
    fav.onclick = async () => {
      const res = await fetch(`/api/images/${it._id}/favorite`, { method: "PATCH" });
      if (res.ok) { it.favorite = (await res.json()).favorite; paint(); if ($("#favOnly").checked) loadGallery(); }
    };
    el.querySelector(".dl").onclick = () => download(it.url, slug(it.prompt));
    el.querySelector(".reuse").onclick = () => {
      try { sessionStorage.setItem("reuse", JSON.stringify({ prompt: it.prompt, seed: it.seed, style: it.style, ratio: it.ratio })); } catch {}
      location.href = "/";
    };
    el.querySelector(".del").onclick = async () => {
      if (!confirm("Delete this image from My images?")) return;
      await fetch(`/api/images/${it._id}`, { method: "DELETE" });
      loadGallery();
    };
    return el;
  }

  let t;
  $("#search").addEventListener("input", () => { clearTimeout(t); t = setTimeout(loadGallery, 300); });
  $("#favOnly").addEventListener("change", loadGallery);
  loadGallery();
}

if ($("#form")) initCreate();
if ($("#grid")) initGallery();
