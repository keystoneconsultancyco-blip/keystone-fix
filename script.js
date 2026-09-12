(function () {
  "use strict";

  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var LOGO_HANDOFF_MS = 1800;
  var LOGO_REMOVE_MS = 2500;

  function revealHero() {
    var heading = document.querySelector(".hero-name");
    var popup = document.querySelector(".popup-card");
    if (!heading) return;

    requestAnimationFrame(function () {
      heading.classList.add("is-in");
    });

    window.setTimeout(function () {
      if (popup) popup.classList.add("is-in");
    }, 550);
  }

  function runLogoIntro(onDone) {
    var overlay = document.querySelector(".intro-overlay");

    var alreadyPlayed = false;
    try {
      alreadyPlayed = sessionStorage.getItem("keystoneIntroPlayed") === "1";
    } catch (e) {}

    if (!overlay || reduceMotion || alreadyPlayed) {
      if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
      onDone();
      return;
    }

    try {
      sessionStorage.setItem("keystoneIntroPlayed", "1");
    } catch (e) {}

    requestAnimationFrame(function () {
      overlay.classList.add("is-visible");
    });

    window.setTimeout(function () {
      overlay.classList.add("is-hidden");
      onDone();
    }, LOGO_HANDOFF_MS);

    window.setTimeout(function () {
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
    }, LOGO_REMOVE_MS);
  }

  function initPopupTilt() {
    var card = document.querySelector(".popup-card");
    if (!card || reduceMotion) return;

    var alreadyPlayed = false;
    try {
      alreadyPlayed = sessionStorage.getItem("keystoneIntroPlayed") === "1";
    } catch (e) {}
    var settleDelay = alreadyPlayed ? 100 : LOGO_HANDOFF_MS + 550 + 900;

    window.setTimeout(function () {
      card.style.transition = "transform 0.2s ease, box-shadow 0.3s ease";
      card.addEventListener("pointermove", function (e) {
        var r = card.getBoundingClientRect();
        var px = (e.clientX - r.left) / r.width - 0.5;
        var py = (e.clientY - r.top) / r.height - 0.5;
        card.style.setProperty("--rx", (py * -6) + "deg");
        card.style.setProperty("--ry", (px * 8) + "deg");
      });
      card.addEventListener("pointerleave", function () {
        card.style.setProperty("--rx", "0deg");
        card.style.setProperty("--ry", "0deg");
      });
    }, settleDelay);
  }

  function runServiceReveal() {
    var cards = Array.prototype.slice.call(document.querySelectorAll(".svc-card-h"));
    if (!cards.length) return;

    if (reduceMotion || !window.IntersectionObserver) {
      cards.forEach(function (c) { c.classList.add("is-in"); });
      return;
    }

    var observer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-in");
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.15, rootMargin: "0px 0px -60px 0px" }
    );

    cards.forEach(function (card, i) {
      card.style.transitionDelay = Math.min(i * 90, 270) + "ms";
      observer.observe(card);
    });
  }

  // Set this to your Apps Script/Zapier endpoint to log quote leads to a Google Sheet.
  var QUOTE_LOG_WEBHOOK = "";

  var REVENUE_MULT = { under500k: 0.7, "500k-2m": 0.85, "2m-5m": 1.0, "5m-10m": 1.25, "10mplus": 1.5 };
  var SCALE_MULT = { justme: 0.6, "2-10": 0.9, "11-50": 1.0, "50plus": 1.3 };
  var INVOICE_VOL_MULT = { under20: 0.85, "20-50": 1.0, "50plus": 1.3 };
  var CALL_VOL_MULT = { under20: 0.85, "20-50": 1.0, "50plus": 1.35 };

  var QUOTE_REQUIRED = {
    audit: ["pain", "scale"],
    setup: ["systems", "scale", "revenue"],
    invoicing: ["volume", "scale", "revenue"],
    phone: ["volume", "scale", "revenue"],
    bundle: ["calls", "invoices", "scale", "revenue"],
  };

  function roundTo(value, unit) {
    return Math.round(value / unit) * unit;
  }

  function fmtGBP(n) {
    return "£" + Math.round(n).toLocaleString("en-GB");
  }

  function isPoorFit(scale, revenue) {
    return scale === "justme" || revenue === "under500k";
  }

  function computeRange(base, mults, opts) {
    opts = opts || {};
    var floorPct = opts.floorPct == null ? 0.7 : opts.floorPct;
    var ceilPct = opts.ceilPct == null ? 2.0 : opts.ceilPct;
    var midUnit = opts.midUnit || 50;
    var mult = mults.reduce(function (a, b) { return a * b; }, 1);
    var raw = base * mult;
    var clamped = Math.min(Math.max(raw, base * floorPct), base * ceilPct);
    var mid = roundTo(clamped, midUnit);
    return { low: roundTo(mid * 0.9, 50), high: roundTo(mid * 1.1, 50), mid: mid };
  }

  function declineResult() {
    return {
      decline: true,
      note: "Thanks for your interest — right now we're focused on established businesses with a larger team. We'll keep your details on file as we grow.",
    };
  }

  var QUOTE_HANDLERS = {
    audit: function (getVals) {
      var scale = getVals("scale")[0];
      if (scale === "justme") return declineResult();
      return {
        decline: false,
        note: "Based on what you've told us, the Finance Ops Audit is a strong starting point for your business.",
      };
    },
    setup: function (getVals) {
      var systems = getVals("systems");
      var scale = getVals("scale")[0];
      var revenue = getVals("revenue")[0];
      if (isPoorFit(scale, revenue)) return declineResult();
      var count = systems.length;
      var base = count <= 1 ? 1500 : count <= 3 ? 2000 : 2500;
      var range = computeRange(base, [REVENUE_MULT[revenue], SCALE_MULT[scale]], { floorPct: 0, ceilPct: Infinity, midUnit: 100 });
      return {
        decline: false,
        range: range,
        unit: " one-off",
        note: "Most businesses with a similar build invest around this to get their systems designed and connected. The exact figure is confirmed on a call.",
      };
    },
    invoicing: function (getVals) {
      var volume = getVals("volume")[0];
      var scale = getVals("scale")[0];
      var revenue = getVals("revenue")[0];
      if (isPoorFit(scale, revenue)) return declineResult();
      var range = computeRange(450, [REVENUE_MULT[revenue], SCALE_MULT[scale], INVOICE_VOL_MULT[volume]]);
      return {
        decline: false,
        range: range,
        unit: "/month",
        note: "Most businesses like yours invest in this range for invoicing and collections. The exact figure is confirmed on a call.",
      };
    },
    phone: function (getVals) {
      var volume = getVals("volume")[0];
      var scale = getVals("scale")[0];
      var revenue = getVals("revenue")[0];
      if (isPoorFit(scale, revenue)) return declineResult();
      var range = computeRange(2200, [REVENUE_MULT[revenue], SCALE_MULT[scale], CALL_VOL_MULT[volume]]);
      return {
        decline: false,
        range: range,
        unit: "/month",
        note: "Most businesses like yours invest in this range for round-the-clock phone booking. The exact figure is confirmed on a call.",
      };
    },
    bundle: function (getVals) {
      var calls = getVals("calls")[0];
      var invoices = getVals("invoices")[0];
      var scale = getVals("scale")[0];
      var revenue = getVals("revenue")[0];
      if (isPoorFit(scale, revenue)) return declineResult();
      var avgVol = (CALL_VOL_MULT[calls] + INVOICE_VOL_MULT[invoices]) / 2;
      var range = computeRange(2650, [REVENUE_MULT[revenue], SCALE_MULT[scale], avgVol]);
      return {
        decline: false,
        range: range,
        unit: "/month",
        note: "Most businesses like yours invest in this range for the full bundle. The exact figure is confirmed on a call.",
      };
    },
  };

  function renderQuoteResult(el, result) {
    if (!el) return;
    if (result.decline) {
      el.innerHTML = '<div class="quote-decline"><p class="quote-note">' + result.note + "</p></div>";
    } else if (result.range) {
      el.innerHTML =
        '<span class="quote-range">' + fmtGBP(result.range.low) + "–" + fmtGBP(result.range.high) +
        '<span class="unit">' + result.unit + "</span></span>" +
        '<p class="quote-note">' + result.note + "</p>" +
        '<a href="#contact" class="btn btn-primary quote-cta">Book a call to confirm</a>';
    } else {
      el.innerHTML =
        '<p class="quote-note">' + result.note + "</p>" +
        '<a href="#contact" class="btn btn-primary quote-cta">Book a call to confirm</a>';
    }
    el.classList.add("is-visible");
  }

  function logQuoteSubmission(type, requiredGroups, getVals, result) {
    if (!QUOTE_LOG_WEBHOOK) return;
    var answers = {};
    requiredGroups.forEach(function (g) { answers[g] = getVals(g); });
    var record = {
      service: type,
      answers: answers,
      outcome: result.decline ? "declined" : "quoted",
      range: result.range || null,
      timestamp: new Date().toISOString(),
    };
    fetch(QUOTE_LOG_WEBHOOK, {
      method: "POST",
      mode: "no-cors",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(record),
    }).catch(function () {});
  }

  var SCALE_OPTIONS = [
    { value: "justme", label: "Just me" },
    { value: "2-10", label: "2-10" },
    { value: "11-50", label: "11-50" },
    { value: "50plus", label: "50+" },
  ];
  var REVENUE_OPTIONS = [
    { value: "under500k", label: "Under £500K" },
    { value: "500k-2m", label: "£500K-£2M" },
    { value: "2m-5m", label: "£2M-£5M" },
    { value: "5m-10m", label: "£5M-£10M" },
    { value: "10mplus", label: "£10M+" },
  ];
  var VOLUME_OPTIONS = [
    { value: "under20", label: "Under 20" },
    { value: "20-50", label: "20-50" },
    { value: "50plus", label: "50+" },
  ];

  var QUOTE_CONFIGS = {
    audit: {
      title: "Finance Ops Audit",
      subtitle: "Two-week engagement",
      submitLabel: "Check if we're a fit",
      incompleteHint: "Please answer both questions.",
      questions: [
        {
          group: "pain",
          label: "What's costing you the most time or money right now?",
          options: [
            { value: "calls", label: "Missed calls" },
            { value: "invoices", label: "Unpaid invoices" },
            { value: "admin", label: "Too much admin" },
            { value: "unsure", label: "Not sure" },
          ],
        },
        { group: "scale", label: "Roughly how many staff do you have?", options: SCALE_OPTIONS },
      ],
    },
    setup: {
      title: "System Setup",
      subtitle: "Four-to-eight-week build",
      submitLabel: "Get my estimate",
      incompleteHint: "Please select at least one system and answer both questions.",
      questions: [
        {
          group: "systems",
          label: "Which systems are you interested in?",
          multi: true,
          options: [
            { value: "invoicing", label: "Invoicing" },
            { value: "collections", label: "Collections" },
            { value: "phone", label: "Phone Booking" },
            { value: "quoting", label: "Quoting" },
            { value: "reporting", label: "Reporting" },
          ],
        },
        { group: "scale", label: "Roughly how many staff do you have?", options: SCALE_OPTIONS },
        { group: "revenue", label: "What's your approximate annual revenue?", options: REVENUE_OPTIONS },
      ],
    },
    invoicing: {
      title: "Invoice + Collections",
      subtitle: "Ongoing retainer",
      submitLabel: "Get my estimate",
      incompleteHint: "Please answer all three questions.",
      questions: [
        { group: "volume", label: "Roughly how many invoices do you send per month?", options: VOLUME_OPTIONS },
        { group: "scale", label: "Roughly how many staff do you have?", options: SCALE_OPTIONS },
        { group: "revenue", label: "What's your approximate annual revenue?", options: REVENUE_OPTIONS },
      ],
    },
    phone: {
      title: "Phone Booking",
      subtitle: "Ongoing retainer",
      submitLabel: "Get my estimate",
      incompleteHint: "Please answer all three questions.",
      questions: [
        { group: "volume", label: "Roughly how many calls do you get per week?", options: VOLUME_OPTIONS },
        { group: "scale", label: "Roughly how many staff do you have?", options: SCALE_OPTIONS },
        { group: "revenue", label: "What's your approximate annual revenue?", options: REVENUE_OPTIONS },
      ],
    },
    bundle: {
      title: "Full Bundle",
      subtitle: "Ongoing retainer",
      submitLabel: "Get my estimate",
      incompleteHint: "Please answer all four questions.",
      questions: [
        { group: "calls", label: "Roughly how many calls do you get per week?", options: VOLUME_OPTIONS },
        { group: "invoices", label: "Roughly how many invoices do you send per month?", options: VOLUME_OPTIONS },
        { group: "scale", label: "Roughly how many staff do you have?", options: SCALE_OPTIONS },
        { group: "revenue", label: "What's your approximate annual revenue?", options: REVENUE_OPTIONS },
      ],
    },
  };

  function renderQuoteModalBody(config) {
    var html = '<h3 class="quote-modal-title">' + config.title + "</h3>";
    html += '<p class="quote-modal-subtitle">' + config.subtitle + "</p>";
    config.questions.forEach(function (q) {
      html += '<div class="quote-question"><span class="quote-question-label">' + q.label + '</span>';
      html += '<div class="quote-options" data-group="' + q.group + '"' + (q.multi ? ' data-multi="true"' : "") + ">";
      q.options.forEach(function (opt) {
        html += '<button type="button" class="qopt" data-value="' + opt.value + '">' + opt.label + "</button>";
      });
      html += "</div></div>";
    });
    html += '<div class="quote-submit-row"><button type="button" class="quote-submit" data-quote-submit>' + config.submitLabel + "</button>";
    html += '<span class="quote-hint" data-quote-hint hidden>' + config.incompleteHint + "</span></div>";
    html += '<div class="quote-result" data-quote-result></div>';
    return html;
  }

  function wireQuoteModalBody(root, type) {
    var submit = root.querySelector("[data-quote-submit]");
    var hint = root.querySelector("[data-quote-hint]");
    var resultEl = root.querySelector("[data-quote-result]");

    Array.prototype.forEach.call(root.querySelectorAll(".quote-options"), function (group) {
      var multi = group.getAttribute("data-multi") === "true";
      group.addEventListener("click", function (e) {
        var btn = e.target.closest ? e.target.closest(".qopt") : null;
        if (!btn || !group.contains(btn)) return;
        if (multi) {
          btn.classList.toggle("is-selected");
        } else {
          Array.prototype.forEach.call(group.querySelectorAll(".qopt"), function (o) {
            o.classList.remove("is-selected");
          });
          btn.classList.add("is-selected");
        }
        if (hint) hint.hidden = true;
      });
    });

    function getVals(group) {
      var els = root.querySelectorAll('.quote-options[data-group="' + group + '"] .qopt.is-selected');
      return Array.prototype.map.call(els, function (el) { return el.getAttribute("data-value"); });
    }

    submit.addEventListener("click", function () {
      var required = QUOTE_REQUIRED[type] || [];
      var complete = required.every(function (g) { return getVals(g).length > 0; });
      if (!complete) {
        if (hint) hint.hidden = false;
        return;
      }
      if (hint) hint.hidden = true;

      var handler = QUOTE_HANDLERS[type];
      if (!handler) return;
      var result = handler(getVals);
      renderQuoteResult(resultEl, result);
      logQuoteSubmission(type, required, getVals, result);
    });
  }

  function initQuoteModal() {
    var overlay = document.querySelector("[data-quote-modal]");
    var triggers = document.querySelectorAll("[data-quote-open]");
    if (!overlay || !triggers.length) return;

    var body = overlay.querySelector("[data-quote-body]");
    var closeBtn = overlay.querySelector("[data-quote-close]");

    function openModal(type) {
      var config = QUOTE_CONFIGS[type];
      if (!config) return;
      body.innerHTML = renderQuoteModalBody(config);
      wireQuoteModalBody(body, type);
      overlay.hidden = false;
      document.body.classList.add("quote-modal-locked");
      requestAnimationFrame(function () {
        overlay.classList.add("is-open");
      });
    }

    function closeModal() {
      overlay.classList.remove("is-open");
      document.body.classList.remove("quote-modal-locked");
      window.setTimeout(function () {
        overlay.hidden = true;
        body.innerHTML = "";
      }, reduceMotion ? 0 : 280);
    }

    Array.prototype.forEach.call(triggers, function (trigger) {
      trigger.addEventListener("click", function () {
        openModal(trigger.getAttribute("data-quote-open"));
      });
    });

    closeBtn.addEventListener("click", closeModal);
    overlay.addEventListener("click", function (e) {
      if (e.target === overlay) closeModal();
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && overlay.classList.contains("is-open")) closeModal();
    });
  }

  function init() {
    runLogoIntro(revealHero);
    initPopupTilt();
    runServiceReveal();
    initQuoteModal();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
