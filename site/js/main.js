/* ==========================================================================
   SereneScape — SKY Residences
   Scroll-scrubbed frame-sequence engine + site interactions
   ========================================================================== */
(function(){
  "use strict";

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  gsap.registerPlugin(ScrollTrigger);
  const allScrubbers = [];

  /* ------------------------------------------------------------------------
     Frame-sequence scrubber
     ------------------------------------------------------------------------ */
  class Scrubber{
    constructor(opts){
      this.id          = opts.id;
      this.wrap        = opts.wrap;
      this.stage       = opts.stage;
      this.canvas      = opts.canvas;
      this.ctx         = this.canvas.getContext("2d");
      this.pathTpl     = opts.pathTpl;
      this.frameCount  = opts.frameCount;
      this.loaderEl    = opts.loaderEl;
      this.counterEl   = opts.counterEl;
      this.onFrame     = opts.onFrame || null;

      this.images      = new Array(this.frameCount);
      this.loadedCount = 0;
      this.ready       = false;
      this.loading     = false;
      this.currentFrame = 0;
      this.dpr = Math.min(window.devicePixelRatio || 1, 2);

      this._resize();
    }

    frameUrl(n){
      const num = String(n).padStart(4, "0");
      return this.pathTpl.replace("%04d", num);
    }

    preload(){
      if(this.loading || this.ready) return this._loadPromise;
      this.loading = true;
      this._loadPromise = new Promise((resolve) => {
        let settled = 0;
        const firstBatch = [0, this.frameCount - 1, Math.floor(this.frameCount/2)];

        const markLoaded = () => {
          settled++;
          this.loadedCount = settled;
          if(settled === this.frameCount){
            this.ready = true;
            this.loading = false;
            if(this.loaderEl) this.loaderEl.classList.add("done");
            this.drawFrame(this.currentFrame);
            resolve();
          }
        };

        for(let i=0; i<this.frameCount; i++){
          const img = new Image();
          img.decoding = "async";
          img.onload = () => {
            markLoaded();
            if(firstBatch.includes(i)) this.drawFrame(this.currentFrame);
          };
          img.onerror = markLoaded;
          img.src = this.frameUrl(i+1);
          this.images[i] = img;
        }
      });
      return this._loadPromise;
    }

    _resize(){
      const rect = this.stage.getBoundingClientRect();
      this.cssW = rect.width || window.innerWidth;
      this.cssH = rect.height || window.innerHeight;
      this.canvas.width  = this.cssW * this.dpr;
      this.canvas.height = this.cssH * this.dpr;
      this.canvas.style.width  = this.cssW + "px";
      this.canvas.style.height = this.cssH + "px";
      this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    }

    drawFrame(index){
      index = Math.max(0, Math.min(this.frameCount - 1, index));
      this.currentFrame = index;
      const img = this.images[index];
      if(!img || !img.complete || !img.naturalWidth) return;

      const cw = this.cssW, ch = this.cssH;
      const iw = img.naturalWidth, ih = img.naturalHeight;
      const scale = Math.max(cw / iw, ch / ih);
      const dw = iw * scale, dh = ih * scale;
      const dx = (cw - dw) / 2, dy = (ch - dh) / 2;

      this.ctx.clearRect(0, 0, cw, ch);
      this.ctx.drawImage(img, dx, dy, dw, dh);

      if(this.counterEl){
        this.counterEl.textContent = String(index+1).padStart(3,"0") + " / " + String(this.frameCount).padStart(3,"0");
      }
      if(this.onFrame) this.onFrame(index, this.frameCount);
    }

    setProgress(p){
      const idx = Math.round(p * (this.frameCount - 1));
      this.drawFrame(idx);
    }
  }

  /* ------------------------------------------------------------------------
     Build a scrubber + pin it to its wrapper via ScrollTrigger
     ------------------------------------------------------------------------ */
  function initSequence(key, { onProgress } = {}){
    const wrap   = document.getElementById(key + "-wrap");
    if(!wrap) return null;
    const stage  = document.getElementById(key + "-stage");
    const canvas = document.getElementById(key + "-canvas");
    const loader = document.getElementById(key + "-loader");
    const counter= document.getElementById(key + "-frame-count");

    const scrubber = new Scrubber({
      id: key,
      wrap, stage, canvas,
      pathTpl: wrap.dataset.path,
      frameCount: parseInt(wrap.dataset.frames, 10),
      loaderEl: loader,
      counterEl: counter
    });

    const scrollVh = parseFloat(wrap.dataset.scrollVh || "300");

    const trigger = ScrollTrigger.create({
      id: key,
      trigger: wrap,
      start: "top top",
      end: "+=" + Math.round(window.innerHeight * (scrollVh / 100)),
      pin: stage,
      anticipatePin: 1,
      scrub: 0.35,
      onUpdate(self){
        scrubber.setProgress(self.progress);
        if(onProgress) onProgress(self.progress);
      }
    });

    scrubber._trigger = trigger;
    scrubber._scrollVh = scrollVh;
    allScrubbers.push(scrubber);

    return scrubber;
  }

  function debounce(fn, wait){
    let t;
    return function(...args){ clearTimeout(t); t = setTimeout(() => fn.apply(this,args), wait); };
  }

  /* ------------------------------------------------------------------------
     Manual smooth scroll (native scrollIntoView smooth stalls when it
     crosses GSAP ScrollTrigger pinned sections, since each pin recalculation
     fights the browser's built-in scroll animation)
     ------------------------------------------------------------------------ */
  function smoothScrollTo(targetY, duration = 900){
    if(reduceMotion){ window.scrollTo(0, targetY); return; }
    const startY = window.scrollY;
    const dist = targetY - startY;
    if(Math.abs(dist) < 2) return;
    const startTime = performance.now();
    const ease = t => t < 0.5 ? 4*t*t*t : 1 - Math.pow(-2*t+2, 3)/2;
    function step(now){
      const t = Math.min(1, (now - startTime) / duration);
      window.scrollTo(0, startY + dist * ease(t));
      if(t < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  /* ------------------------------------------------------------------------
     Threshold helper — toggle a class across progress ranges
     ------------------------------------------------------------------------ */
  function stageSwitcher(map){
    // map: [{el, from, to}]
    return (p) => {
      map.forEach(({el, from, to}) => {
        if(!el) return;
        const active = p >= from && p < to;
        el.classList.toggle("active", active);
      });
    };
  }

  /* ------------------------------------------------------------------------
     Init on DOM ready
     ------------------------------------------------------------------------ */
  document.addEventListener("DOMContentLoaded", () => {

    /* ---------------- Preloader + Hero sequence ---------------- */
    const preloader   = document.getElementById("preloader");
    const preloaderPct= document.getElementById("preloader-pct");
    const preloaderBar= document.querySelector(".preloader-bar");

    const heroSwitch = stageSwitcher([
      { el: document.getElementById("hero-badge"),   from: 0,    to: 0.14 },
      { el: document.getElementById("hero-text-1"),  from: 0.14, to: 0.56 },
      { el: document.getElementById("hero-text-2"),  from: 0.56, to: 1.01 },
    ]);
    const scrollCue = document.getElementById("scroll-cue");

    const heroScrubber = initSequence("hero", {
      onProgress(p){
        heroSwitch(p);
        if(scrollCue) scrollCue.style.opacity = p > 0.02 ? "0" : "1";
      }
    });

    // Poll actual loaded count for a smoother % readout
    const pollHero = setInterval(() => {
      const pct = Math.round((heroScrubber.loadedCount / heroScrubber.frameCount) * 100);
      if(preloaderBar) preloaderBar.style.setProperty("--p", pct + "%");
      if(preloaderPct) preloaderPct.textContent = "Loading " + pct + "%";
      if(heroScrubber.ready){
        clearInterval(pollHero);
        setTimeout(() => {
          preloader.classList.add("hidden");
          document.body.classList.remove("lock-scroll");
          ScrollTrigger.refresh();
        }, 250);
      }
    }, 80);

    document.body.classList.add("lock-scroll");
    heroScrubber.preload();

    // Safety: never block the site for more than 6s
    setTimeout(() => {
      preloader.classList.add("hidden");
      document.body.classList.remove("lock-scroll");
    }, 6000);

    /* ---------------- Interior sequence (lazy) ---------------- */
    const interiorSwitch = stageSwitcher([
      { el: document.getElementById("int-text-0"), from: 0,    to: 0.42 },
      { el: document.getElementById("int-text-1"), from: 0.42, to: 0.64 },
      { el: document.getElementById("int-text-2"), from: 0.64, to: 1.01 },
    ]);
    let interiorScrubber = null;
    const interiorWrap = document.getElementById("interior-wrap");
    if(interiorWrap){
      interiorScrubber = initSequence("interior", { onProgress: interiorSwitch });
      lazyPreload(interiorWrap, interiorScrubber);
    }

    /* ---------------- Masterplan sequence (lazy) ---------------- */
    const mpTags = [
      { el: document.getElementById("mp-text-0"), from: 0,    to: 0.16 },
      { el: document.getElementById("mp-tag-5"),  from: 0.08, to: 0.97 },
      { el: document.getElementById("mp-tag-1"),  from: 0.20, to: 0.97 },
      { el: document.getElementById("mp-tag-2"),  from: 0.34, to: 0.97 },
      { el: document.getElementById("mp-tag-3"),  from: 0.50, to: 0.97 },
      { el: document.getElementById("mp-tag-4"),  from: 0.66, to: 0.97 },
    ];
    const masterplanSwitch = stageSwitcher(mpTags);
    let masterplanScrubber = null;
    const mpWrap = document.getElementById("masterplan-wrap");
    if(mpWrap){
      masterplanScrubber = initSequence("masterplan", { onProgress: masterplanSwitch });
      lazyPreload(mpWrap, masterplanScrubber);
    }

    function lazyPreload(wrapEl, scrubber){
      let triggered = false;
      const trigger = () => {
        if(triggered) return;
        triggered = true;
        scrubber.preload();
        io.disconnect();
        window.removeEventListener("scroll", onScroll);
      };

      // Primary: IntersectionObserver.
      const io = new IntersectionObserver((entries) => {
        entries.forEach(entry => { if(entry.isIntersecting) trigger(); });
      }, { rootMargin: "60% 0px" });
      io.observe(wrapEl);

      // Fallback: some browsers/embedded contexts throttle or delay IO
      // callbacks for backgrounded/inactive documents. A plain scroll-
      // proximity check guarantees the sequence still loads in time.
      const onScroll = () => {
        const r = wrapEl.getBoundingClientRect();
        if(r.top < window.innerHeight * 1.6 && r.bottom > 0) trigger();
      };
      window.addEventListener("scroll", onScroll, { passive:true });
      onScroll();
    }

    /* ---------------- Nav ---------------- */
    const nav = document.getElementById("nav");
    const navToggle = document.getElementById("nav-toggle");
    const navLinks = document.querySelectorAll("#nav-links a");

    window.addEventListener("scroll", () => {
      nav.classList.toggle("scrolled", window.scrollY > 40);
    }, { passive:true });

    navToggle.addEventListener("click", () => {
      document.body.classList.toggle("nav-open");
    });
    navLinks.forEach(a => a.addEventListener("click", (e) => {
      document.body.classList.remove("nav-open");
      const target = document.querySelector(a.getAttribute("href"));
      if(target){
        e.preventDefault();
        const navH = nav.getBoundingClientRect().height;
        const y = target.getBoundingClientRect().top + window.scrollY - navH + 1;
        smoothScrollTo(y);
      }
    }));

    // Active section highlight
    const sections = [...navLinks].map(a => document.querySelector(a.getAttribute("href"))).filter(Boolean);
    const sectionObserver = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        const id = entry.target.id;
        const link = document.querySelector(`#nav-links a[href="#${id}"]`);
        if(!link) return;
        if(entry.isIntersecting) navLinks.forEach(l => l.style.color = "");
        if(entry.isIntersecting) link.style.color = "var(--accent-light)";
      });
    }, { rootMargin: "-45% 0px -45% 0px" });
    sections.forEach(s => sectionObserver.observe(s));

    /* ---------------- Reveal on scroll ---------------- */
    const revealEls = document.querySelectorAll(".reveal");
    const revealObserver = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if(entry.isIntersecting){
          entry.target.classList.add("is-visible");
          revealObserver.unobserve(entry.target);
        }
      });
    }, { threshold: 0.15, rootMargin: "0px 0px -60px 0px" });
    revealEls.forEach(el => revealObserver.observe(el));

    /* ---------------- Lightbox gallery ---------------- */
    const lightbox   = document.getElementById("lightbox");
    const lbImg      = document.getElementById("lb-img");
    const lbCaption  = document.getElementById("lb-caption");
    const lbClose    = document.getElementById("lb-close");
    const lbPrev     = document.getElementById("lb-prev");
    const lbNext     = document.getElementById("lb-next");

    const lbItems = [...document.querySelectorAll("[data-lightbox]")].map(el => ({
      src: el.dataset.lightbox,
      caption: el.dataset.caption || ""
    }));
    let lbIndex = 0;

    function openLightbox(i){
      lbIndex = (i + lbItems.length) % lbItems.length;
      const item = lbItems[lbIndex];
      lbImg.src = item.src;
      lbImg.alt = item.caption;
      lbCaption.textContent = item.caption;
      lightbox.classList.add("open");
      document.body.classList.add("lock-scroll");
    }
    function closeLightbox(){
      lightbox.classList.remove("open");
      document.body.classList.remove("lock-scroll");
    }

    document.querySelectorAll("[data-lightbox]").forEach((el, i) => {
      el.addEventListener("click", () => openLightbox(i));
    });
    lbClose.addEventListener("click", closeLightbox);
    lbPrev.addEventListener("click", () => openLightbox(lbIndex - 1));
    lbNext.addEventListener("click", () => openLightbox(lbIndex + 1));
    lightbox.addEventListener("click", (e) => { if(e.target === lightbox) closeLightbox(); });
    document.addEventListener("keydown", (e) => {
      if(!lightbox.classList.contains("open")) return;
      if(e.key === "Escape") closeLightbox();
      if(e.key === "ArrowLeft") openLightbox(lbIndex - 1);
      if(e.key === "ArrowRight") openLightbox(lbIndex + 1);
    });

    /* ---------------- Contact form ---------------- */
    const contactForm = document.getElementById("contact-form");
    const formSuccess = document.getElementById("form-success");
    contactForm.addEventListener("submit", (e) => {
      e.preventDefault();
      if(!contactForm.checkValidity()){
        contactForm.reportValidity();
        return;
      }
      formSuccess.classList.add("show");
      contactForm.querySelector(".submit-row").style.display = "none";
      contactForm.reset();
    });

    const newsletterForm = document.getElementById("newsletter-form");
    newsletterForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const input = newsletterForm.querySelector("input");
      const btn = newsletterForm.querySelector("button");
      input.value = "";
      input.placeholder = "Subscribed ✓";
      btn.style.color = "var(--accent-light)";
    });

    /* ---------------- Back to top ---------------- */
    const toTop = document.getElementById("to-top");
    window.addEventListener("scroll", () => {
      toTop.classList.toggle("show", window.scrollY > 800);
    }, { passive:true });
    toTop.addEventListener("click", () => smoothScrollTo(0));

    /* ---------------- Refresh ScrollTrigger after full load ---------------- */
    window.addEventListener("load", () => ScrollTrigger.refresh());

    /* ---------------- Coordinated resize: canvases + pin distances ---------------- */
    window.addEventListener("resize", debounce(() => {
      const vh = window.innerHeight;
      allScrubbers.forEach(s => {
        if(s._trigger) s._trigger.vars.end = "+=" + Math.round(vh * (s._scrollVh / 100));
        s._resize();
        s.drawFrame(s.currentFrame);
      });
      ScrollTrigger.refresh();
    }, 200));
  });
})();
