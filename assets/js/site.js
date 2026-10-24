/* ============================================================
   site.js — single behavior script for the whole site
   Data-attribute driven:
     [data-menu-open] / [data-menu-close]  → #menu overlay
     [data-type] (+ data-prefix/data-append) → typewriter
     .reveal (gated by .reveal-ready on <html>) → scroll-in animations
     [data-year]                            → current year stamp
     [data-counts] root + [data-count]      → HTB counters (fetches JSON)
     #boxList (+ #list-label)               → HTB box list (?os= filter)
     #toc-list inside .toc                  → built from .post h2/h3/h4 + scroll-spy
     .progress                              → reading progress bar
     [data-scroll-hint]                     → "scroll to explore" button (built here)
      .post figure img                       → shared image viewer (lightbox)
      .post figure.bookmark                  → Notion-style external bookmark cards
   All motion respects prefers-reduced-motion.
   ============================================================ */

(function () {
  "use strict";

  var reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  /* Page switches in the rail: the clicked item is remembered for one
     navigation and re-applied in its hover look on the new page, with
     transitions held until the pointer moves. It then eases back normally
     instead of snapping or replaying the hover animation. */
  (function () {
    var root = document.documentElement;
    var KEY = "fg-nav-carry";
    var carried = null;
    root.classList.add("nav-still");

    try {
      var href = sessionStorage.getItem(KEY);
      sessionStorage.removeItem(KEY);
      if (href) {
        carried = $all(".spine nav a").filter(function (a) { return a.href === href; })[0] || null;
        if (carried) carried.classList.add("nav-carry");
      }
    } catch (e) { /* storage blocked: plain load */ }

    document.addEventListener("click", function (e) {
      var a = e.target.closest && e.target.closest(".spine nav a");
      if (!a) return;
      try { sessionStorage.setItem(KEY, a.href); } catch (err) { /* ignore */ }
    });

    function release() {
      if (!carried) return;
      var el = carried;
      carried = null;
      el.classList.remove("nav-carry");
    }

    function wake() {
      window.removeEventListener("pointermove", wake, true);
      window.removeEventListener("keydown", wake, true);
      window.removeEventListener("touchstart", wake, true);
      root.classList.remove("nav-still");
      if (!carried) return;
      /* Let the transition rules apply first, then drop the carry: if the
         pointer is still on the item :hover holds the same look, otherwise
         it eases back. */
      requestAnimationFrame(function () {
        requestAnimationFrame(release);
      });
    }

    window.addEventListener("pointermove", wake, true);
    window.addEventListener("keydown", wake, true);
    window.addEventListener("touchstart", wake, true);
  })();

  function $(sel, root) {
    return (root || document).querySelector(sel);
  }

  function $all(sel, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(sel));
  }

  /* ---------- Mobile menu ---------- */

  function initMenu() {
    var menu = $("#menu");
    if (!menu) return;
    /* Closed overlay: not focusable, not interactive, hidden from a11y tree */
    menu.inert = true;

    var openBtn = $("[data-menu-open]");
    var closeBtn = $("[data-menu-close]");

    function setOpen(open) {
      menu.classList.toggle("open", open);
      menu.inert = !open;
      document.body.style.overflow = open ? "hidden" : "";
      menu.setAttribute("aria-hidden", open ? "false" : "true");
      if (openBtn) openBtn.setAttribute("aria-expanded", open ? "true" : "false");
      if (open) {
        if (closeBtn) closeBtn.focus();
      } else if (openBtn) {
        openBtn.focus();
      }
    }

    /* Keep Tab cycling inside the overlay while it is open */
    menu.addEventListener("keydown", function (e) {
      if (e.key !== "Tab" || !menu.classList.contains("open")) return;
      var focusable = $all(
        'a[href], button:not([disabled])',
        menu
      );
      if (!focusable.length) return;
      var first = focusable[0];
      var last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    });

    if (openBtn) {
      openBtn.setAttribute("aria-expanded", "false");
      openBtn.addEventListener("click", function () {
        setOpen(true);
      });
    }
    if (closeBtn) {
      closeBtn.addEventListener("click", function () {
        setOpen(false);
      });
    }

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && menu.classList.contains("open")) {
        setOpen(false);
      }
    });

    $all("a", menu).forEach(function (link) {
      link.addEventListener("click", function () {
        setOpen(false);
      });
    });
  }

  /* ---------- Storage helpers (versioned 3-layer chain) ----------
     Preferences live in one timestamped record: <base36 ts>.<theme>.<rail>.
     Every write mirrors that record to localStorage, a cookie and
     window.name. Reads inspect every copy and take the newest valid one,
     so a partitioned/cleared layer (Firefox containers, Zen contextual
     isolation, private windows) can never resurrect an older value just
     because localStorage happens to be read first. Legacy fg-theme /
     fg-spine-v2 values are read once and migrated to the new record. */

  var PREFS_KEY = "fg-prefs";
  var LEGACY_THEME_KEY = "fg-theme";
  var LEGACY_RAIL_KEY = "fg-spine-v2";

  function nameSet(key, value) {
    var pairs = String(window.name || "").split(";");
    var out = [];
    var found = false;
    for (var i = 0; i < pairs.length; i++) {
      if (pairs[i] === "") continue;
      var kv = pairs[i].split("=");
      if (kv[0] === key) {
        if (!found) {
          out.push(key + "=" + value);
          found = true;
        }
      } else {
        out.push(pairs[i]);
      }
    }
    if (!found) out.push(key + "=" + value);
    window.name = out.join(";");
  }

  function layerGet(key) {
    var out = [];
    /* window.name first: it survives same-tab navigation even when
       Firefox partitions or clears the other two layers. */
    try {
      var pairs = String(window.name || "").split(";");
      for (var i = 0; i < pairs.length; i++) {
        var kv = pairs[i].split("=");
        if (kv[0] === key && kv[1]) out.push(kv[1]);
      }
    } catch (e) {
      /* window.name unavailable */
    }
    try {
      var m = document.cookie.match(new RegExp("(?:^|; )" + key + "=([^;]*)"));
      if (m) out.push(decodeURIComponent(m[1]));
    } catch (e) {
      /* cookies blocked */
    }
    try {
      var local = localStorage.getItem(key);
      if (local !== null && typeof local !== "undefined") out.push(local);
    } catch (e) {
      /* storage blocked */
    }
    return out;
  }

  function layerSet(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch (e) {
      /* storage blocked */
    }
    try {
      document.cookie =
        key + "=" + encodeURIComponent(value) + "; max-age=31536000; samesite=lax; path=/";
    } catch (e) {
      /* cookies blocked */
    }
    try {
      nameSet(key, value);
    } catch (e) {
      /* window.name unavailable */
    }
  }

  function parsePrefs(raw) {
    if (!raw || typeof raw !== "string") return null;
    var parts = raw.split(".");
    if (parts.length !== 3) return null;
    var ts = parseInt(parts[0], 36);
    if (!isFinite(ts) || ts <= 0) return null;
    var theme = parts[1] === "light" || parts[1] === "dark" ? parts[1] : null;
    var rail = parts[2] === "c" || parts[2] === "o" ? parts[2] : null;
    if (!theme && !rail) return null;
    return { ts: ts, theme: theme, rail: rail };
  }

  function readPrefs() {
    var best = null;
    layerGet(PREFS_KEY).forEach(function (raw) {
      var parsed = parsePrefs(raw);
      if (parsed && (!best || parsed.ts > best.ts)) best = parsed;
    });
    if (best) {
      return { ts: best.ts, theme: best.theme, rail: best.rail, legacy: false };
    }

    var theme = null;
    var rail = null;
    layerGet(LEGACY_THEME_KEY).some(function (v) {
      if (v === "light" || v === "dark") {
        theme = v;
        return true;
      }
      return false;
    });
    layerGet(LEGACY_RAIL_KEY).some(function (v) {
      if (v === "c" || v === "o") {
        rail = v;
        return true;
      }
      return false;
    });
    if (theme || rail) {
      return { ts: 0, theme: theme, rail: rail, legacy: true };
    }
    return null;
  }

  function writePrefs(next) {
    if (!next.theme && !next.rail) return;
    var current = readPrefs();
    var ts = Date.now();
    if (current && current.ts >= ts) ts = current.ts + 1;
    var raw =
      ts.toString(36) +
      "." +
      (next.theme || "") +
      "." +
      (next.rail || "");
    layerSet(PREFS_KEY, raw);
    /* Keep the legacy keys in sync so a cached page running the old
       bootstrap still restores the same value during migration. */
    if (next.theme) layerSet(LEGACY_THEME_KEY, next.theme);
    if (next.rail) layerSet(LEGACY_RAIL_KEY, next.rail);
  }

  function savePrefs(patch) {
    var current = readPrefs() || {};
    var theme =
      patch.theme ||
      current.theme ||
      (document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark");
    var rail =
      patch.rail ||
      current.rail ||
      (document.documentElement.classList.contains("nav-collapsed") ? "c" : "o");
    writePrefs({ theme: theme, rail: rail });
    return { theme: theme, rail: rail };
  }

  function applyPersisted() {
    var prefs = readPrefs();
    if (prefs && prefs.theme) {
      document.documentElement.setAttribute("data-theme", prefs.theme);
    }
    /* Rail defaults to collapsed: only an explicit "o" preference opens it,
       matching the inline head bootstrap. No saved pref (or theme-only) stays
       collapsed. */
    var rail = prefs ? prefs.rail : null;
    document.documentElement.classList.toggle("nav-collapsed", rail !== "o");
    /* Normalise the three layers once, so later reads never have to
       fall back to the unversioned keys. */
    if (prefs && prefs.legacy && (prefs.theme || prefs.rail)) {
      writePrefs({ theme: prefs.theme, rail: prefs.rail });
    }
  }

  /* ---------- Rail collapse toggle (desktop) ---------- */

  function initSpine() {
    var html = document.documentElement;
    var btn = $("[data-spine-toggle]");
    if (!btn) return;

    applyPersisted();

    function collapsed() {
      return html.classList.contains("nav-collapsed");
    }

    function apply() {
      var c = collapsed();
      btn.setAttribute("aria-expanded", c ? "false" : "true");
      btn.setAttribute("aria-label", c ? "Expand navigation" : "Collapse navigation");
    }

    btn.addEventListener("click", function () {
      var c = !collapsed();
      html.classList.toggle("nav-collapsed", c);
      savePrefs({ rail: c ? "c" : "o" });
      apply();
    });

    apply();

    /* Browsers that restore pages from the back/forward cache (Firefox,
       Zen, Safari) skip a fresh script run — re-apply the saved state.
       A normal Firefox navigation also fires pageshow without persisted,
       so always re-apply instead of relying on the flag. */
    window.addEventListener("pageshow", function () {
      applyPersisted();
      apply();
    });

    /* Another tab/window changed the preference: mirror it here. */
    window.addEventListener("storage", function (e) {
      if (e.key !== PREFS_KEY && e.key !== LEGACY_THEME_KEY && e.key !== LEGACY_RAIL_KEY) {
        return;
      }
      applyPersisted();
      apply();
    });
  }

  /* ---------- Color theme ---------- */

  function initTheme() {
    var root = document.documentElement;

    /* Hardening: re-apply the saved theme if the inline head script
       didn't run or ran without working storage. */
    applyPersisted();

    var btns = $all("[data-theme-toggle]");
    if (!btns.length) return;

    function current() {
      return root.getAttribute("data-theme") === "light" ? "light" : "dark";
    }

    function sync() {
      var dark = current() === "dark";
      btns.forEach(function (b) {
        /* pressed reflects the non-default (dark) state being active */
        b.setAttribute("aria-pressed", dark ? "true" : "false");
        b.setAttribute(
          "aria-label",
          dark ? "Switch to light theme" : "Switch to dark theme"
        );
      });
    }

    btns.forEach(function (b) {
      b.addEventListener("click", function () {
        var next = current() === "light" ? "dark" : "light";
        root.setAttribute("data-theme", next);
        savePrefs({ theme: next });
        sync();
      });
    });

    sync();

    /* Back/forward cache restores (Firefox/Zen, Safari) skip a fresh
       script run — re-apply the saved state when they surface again. */
    window.addEventListener("pageshow", function () {
      applyPersisted();
      sync();
    });

    window.addEventListener("storage", function (e) {
      if (e.key !== PREFS_KEY && e.key !== LEGACY_THEME_KEY && e.key !== LEGACY_RAIL_KEY) {
        return;
      }
      applyPersisted();
      sync();
    });
  }

  /* ---------- Typewriter ---------- */

  function typeText(el, text, done) {
    var i = 0;
    var reserve = el.querySelector(".type-reserve");
    /* Keep the whole title around a second, even for long post titles. */
    var speed = Math.max(18, Math.min(55, 900 / Math.max(1, text.length)));
    (function step() {
      if (i < text.length) {
        if (reserve) {
          el.insertBefore(document.createTextNode(text.charAt(i)), reserve);
        } else {
          el.textContent += text.charAt(i);
        }
        i += 1;
        window.setTimeout(step, speed);
      } else if (typeof done === "function") {
        done();
      }
    })();
  }

  function initTypewriters() {
    $all("[data-type]").forEach(function (el) {
      var prefix = el.getAttribute("data-prefix") || "";
      var suffix = el.getAttribute("data-append") || "";
      var text = el.getAttribute("data-type");
      var reserve = document.createElement("span");
      reserve.className = "type-reserve";
      reserve.setAttribute("aria-hidden", "true");
      reserve.textContent = prefix + text + suffix;
      el.appendChild(reserve);

      function measure() {
        var clone = el.cloneNode(false);
        clone.classList.add("type-measure");
        clone.textContent = prefix + text + suffix;
        clone.style.position = "absolute";
        clone.style.visibility = "hidden";
        clone.style.pointerEvents = "none";
        clone.style.width = el.getBoundingClientRect().width + "px";
        clone.style.minHeight = "0";
        clone.style.height = "auto";
        clone.style.top = "-10000px";
        clone.style.left = "0";
        el.parentNode.appendChild(clone);
        var height = clone.getBoundingClientRect().height;
        clone.remove();
        if (height > 0) el.style.minHeight = Math.ceil(height) + "px";
      }

      measure();
      window.addEventListener("resize", measure, { passive: true });
      if (document.fonts && document.fonts.ready) {
        document.fonts.ready.then(measure);
      }

      if (reducedMotion.matches) {
        el.textContent = prefix + text + suffix;
        el.appendChild(reserve);
        return;
      }

      el.textContent = prefix;
      el.appendChild(reserve);
      typeText(el, text, function () {
        el.textContent = prefix + text + suffix;
        el.appendChild(reserve);
        el.classList.add("typed");
      });
    });
  }

  /* ---------- Scroll reveals ---------- */

  var revealObserver = null;
  var revealFallback = false;

  function markRevealed(el) {
    if (!el || el.classList.contains("in")) return;
    el.classList.add("in");
  }

  function observeReveal(el) {
    if (!el || el.classList.contains("in")) return;
    /* No observer (reduced motion, old browser, or content added before
       initReveals) means the element must stay visible. */
    if (revealFallback || !revealObserver) {
      el.classList.add("instant");
      markRevealed(el);
      return;
    }
    revealObserver.observe(el);
  }

  function initReveals() {
    /* Blog post pages: let every direct child of the article reveal in
       (title, meta, figure, headings, paragraphs) without hand-marking up. */
    var post = $(".post");
    if (post) {
      Array.prototype.slice.call(post.children).forEach(function (el) {
        el.classList.add("reveal");
      });
    }

    var items = $all(".reveal");
    if (!items.length) return;

    document.documentElement.classList.add("reveal-ready");

    /* Everything already on screen at load is shown immediately, so a
       page load is instant. Only blocks entering during scrolling fade. */
    var viewport = window.innerHeight || document.documentElement.clientHeight;
    items.forEach(function (el) {
      if (el.getBoundingClientRect().top < viewport) {
        el.classList.add("instant");
        markRevealed(el);
      }
    });

    if (reducedMotion.matches || !("IntersectionObserver" in window)) {
      revealFallback = true;
      items.forEach(function (el) {
        el.classList.add("instant");
        markRevealed(el);
      });
      return;
    }

    try {
      revealObserver = new IntersectionObserver(
        function (entries) {
          /* Threshold 0 + a tiny bottom margin starts the fade just before
             a block enters, so the movement is visible while scrolling
             without leaving a partially visible paragraph invisible. */
          entries.forEach(function (entry) {
            if (!entry.isIntersecting) return;
            revealObserver.unobserve(entry.target);
            markRevealed(entry.target);
          });
        },
        { threshold: 0, rootMargin: "0px 0px 4% 0px" }
      );

      items.forEach(observeReveal);
    } catch (e) {
      /* Never leave content hidden if the observer cannot be created. */
      revealFallback = true;
      items.forEach(function (el) {
        el.classList.add("instant");
        markRevealed(el);
      });
    }
  }

  /* ---------- Year stamp ---------- */

  function initYears() {
    var year = String(new Date().getFullYear());
    $all("[data-year]").forEach(function (el) {
      el.textContent = year;
    });
  }

  function initFavicon() {
    var icon = document.querySelector('link[rel="icon"][type="image/svg+xml"]');
    if (!icon) return;
    var original = icon.getAttribute("href") || "favicon.svg";
    var base = original.replace(/favicon(?:-dark|-light)?\.svg(?:\?.*)?$/, "");

    function sync() {
      var theme = document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark";
      icon.setAttribute("href", base + "favicon-" + theme + ".svg");
    }

    sync();
    new MutationObserver(sync).observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"]
    });
  }

  /* Restart the roadmap animation when responsive layout changes direction.
     CSS changes the line from horizontal to vertical at the mobile breakpoint,
     but an existing animation keeps its old phase unless explicitly reset. */

  function initTimelineResizeSync() {
    var timeline = $(".xp");
    if (!timeline || !window.matchMedia) return;

    var mobile = window.matchMedia("(max-width: 999px)");
    var wasMobile = mobile.matches;

    function restart() {
      timeline.classList.add("timeline-restart");
      void timeline.offsetWidth;
      timeline.classList.remove("timeline-restart");
    }

    function check() {
      if (mobile.matches !== wasMobile) {
        wasMobile = mobile.matches;
        restart();
      }
    }

    if (mobile.addEventListener) {
      mobile.addEventListener("change", check);
    } else {
      window.addEventListener("resize", check, { passive: true });
    }
  }

  /* ---------- Bare URL links ----------
     Links whose visible text is the raw URL (Notion inline mentions) get a
     readable label: protocol, tracking params and www stripped, path kept for
     context, long URLs truncated. The href is untouched; the full URL stays
     available as the title attribute. Links inside code/pre blocks are left
     alone (they are part of commands and payloads). */

  function shortenUrl(url) {
    var s = url.replace(/^https?:\/\//, "").replace(/^www\./, "");
    s = s.replace(/\?utm_[^?]*$/, "").replace(/\?source=post_page[^?]*$/, "");
    if (s.length > 56) s = s.slice(0, 55) + "…";
    return s;
  }

  function initBareUrls() {
    $all(".post a[href]").forEach(function (a) {
      var href = a.getAttribute("href") || "";
      if (!/^https?:\/\//.test(href)) return;
      if (a.closest("pre, code")) return;
      var text = (a.textContent || "").trim();
      if (!text || !/^https?:\/\//.test(text)) return;
      if (href.replace(/\/+$/, "") !== text.replace(/\/+$/, "")) return;
      var url;
      try {
        url = new URL(href);
      } catch (err) {
        return;
      }

      var label = shortenUrl(href);
      var favicon = document.createElement("img");
      favicon.className = "bare-url-favicon";
      favicon.alt = "";
      favicon.width = 14;
      favicon.height = 14;
      favicon.loading = "lazy";
      favicon.decoding = "async";
      favicon.referrerPolicy = "no-referrer";
      favicon.src = url.origin + "/favicon.ico";
      favicon.addEventListener("error", function () {
        favicon.remove();
      });

      a.classList.add("bare-url");
      a.textContent = "";
      a.appendChild(favicon);
      a.appendChild(document.createTextNode(label));
      a.title = href;
    });
  }

  /* ---------- Post panel split ----------
     Keep the article header and reading body as two real layout regions. This
     avoids trying to split one absolute glass overlay at a guessed height,
     which breaks as titles and metadata wrap at different viewport widths. */

  function initPostPanels() {
    $all(".post").forEach(function (post) {
      if ($(".post-head", post) || !$(".info", post)) return;

      var head = document.createElement("div");
      var body = document.createElement("div");
      head.className = "post-head";
      body.className = "post-body";
      var cover = post.getAttribute("data-cover");
      if (cover) {
        var coverUrl = new URL(cover, document.baseURI).href;
        head.style.setProperty("--post-cover", 'url("' + coverUrl.replace(/"/g, "\\\"") + '")');
      }

      var children = Array.prototype.slice.call(post.children);
      var infoSeen = false;
      children.forEach(function (child) {
        var isInfo = child.classList.contains("info");
        (infoSeen ? body : head).appendChild(child);
        if (isInfo) infoSeen = true;
      });

      post.appendChild(head);
      post.appendChild(body);
    });
  }

  function initHtbReferences() {
    $all('.post[data-cover*="/htb/"] .info').forEach(function (info) {
      if ($(".meta-item[data-htb-reference]", info)) return;
      var post = info.closest(".post");
      var title = $("h1[data-type]", post);
      var name = title ? title.getAttribute("data-type") : "";
      if (!name || name.toLowerCase().indexOf("pro lab") !== -1) return;

      var isEvent = name.toLowerCase().indexOf("cyber apocalypse") !== -1;
      var url = isEvent
        ? "https://app.hackthebox.com/events?search=" + encodeURIComponent(name)
        : "https://app.hackthebox.com/machines/" + encodeURIComponent(name);

      var item = document.createElement("div");
      item.className = "meta-item";
      item.setAttribute("data-htb-reference", "");
      item.innerHTML =
        '<span class="meta-k"><svg viewBox="0 0 24 24" fill="none" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m12 2 9 5v10l-9 5-9-5V7l9-5z"/><path d="M12 7v10M3 7l9 5 9-5"/></svg> Reference</span>' +
        '<a class="meta-v meta-link" href="' + url + '" target="_blank" rel="noopener noreferrer">HTB reference</a>';
      info.appendChild(item);
    });
  }

  /* ---------- External bookmarks ----------
     Notion exports these as a figure containing one external link. Build the
     small amount of structure that CSS cannot provide: the site's favicon,
     title, and a readable host/path line. The original anchor is retained so
     links, target behavior, and keyboard access remain unchanged. */

  function initBookmarks() {
    $all(".post figure:not(:has(img)) > p > a[target='_blank']").forEach(function (a) {
      var figure = a.closest("figure");
      var p = a.parentElement;
      if (!figure || !p || figure.classList.contains("bookmark-ready")) return;

      var href = a.getAttribute("href") || "";
      var url;
      try {
        url = new URL(href, window.location.href);
      } catch (err) {
        return;
      }
      if (url.protocol !== "http:" && url.protocol !== "https:") return;

      var description = Array.prototype.slice.call(p.childNodes).filter(function (node) {
        return node !== a;
      }).map(function (node) {
        return node.textContent || "";
      }).join("").replace(/^\s*-\s*/, "").trim();

      figure.classList.add("bookmark", "bookmark-ready");
      p.classList.add("bookmark-card");

      var icon = document.createElement("span");
      icon.className = "bookmark-icon";
      icon.setAttribute("aria-hidden", "true");

      var favicon = document.createElement("img");
      favicon.alt = "";
      favicon.width = 32;
      favicon.height = 32;
      favicon.loading = "lazy";
      favicon.decoding = "async";
      favicon.referrerPolicy = "no-referrer";
      favicon.src = url.origin + "/favicon.ico";
      favicon.addEventListener("error", function () {
        if (favicon.dataset.fallback) {
          icon.classList.add("bookmark-icon-missing");
          favicon.remove();
          return;
        }
        favicon.dataset.fallback = "true";
        favicon.src = "https://www.google.com/s2/favicons?domain=" + encodeURIComponent(url.hostname) + "&sz=64";
      });
      icon.appendChild(favicon);

      var body = document.createElement("span");
      body.className = "bookmark-body";

      var title = document.createElement("span");
      title.className = "bookmark-title";
      title.appendChild(a);

      var host = document.createElement("span");
      host.className = "bookmark-url";
      host.textContent = url.hostname + (url.pathname !== "/" ? url.pathname : "");

      body.appendChild(title);
      body.appendChild(host);
      if (description) {
        var summary = document.createElement("span");
        summary.className = "bookmark-description";
        summary.textContent = description;
        body.appendChild(summary);
      }

      p.textContent = "";
      p.appendChild(icon);
      p.appendChild(body);
    });
  }

  /* ---------- JSON fetch helper ---------- */

  function fetchJSON(url) {
    return fetch(url, { cache: "no-cache" }).then(function (res) {
      if (!res.ok) {
        throw new Error("HTTP " + res.status + " for " + url);
      }
      return res.json();
    });
  }

  /* ---------- HTB counters ---------- */

  function initCounters() {
    $all("[data-counts]").forEach(function (root) {
      var src = root.getAttribute("data-counts");
      fetchJSON(src)
        .then(function (boxes) {
          $all("[data-count]", root).forEach(function (el) {
            var os = el.getAttribute("data-count");
            var n = boxes.filter(function (b) {
              return b.os === os && !b.soon;
            }).length;
            el.textContent = String(n).padStart(2, "0");
          });
        })
        .catch(function (err) {
          console.error("site.js: counters failed:", err);
        });
    });
  }

  /* ---------- HTB category board ordering ---------- */

  function initBoardSort() {
    var boards = $all(".board");
    if (!boards.length) return;
    var rank = { Easy: 1, Medium: 2, Hard: 3 };

    function sortBoards(byUrl) {
      boards.forEach(function (board) {
        var items = Array.prototype.slice.call(board.children);
        items.sort(function (a, b) {
          var aHref = a.querySelector("a") && a.querySelector("a").getAttribute("href");
          var bHref = b.querySelector("a") && b.querySelector("a").getAttribute("href");
          var aBox = byUrl[aHref] || {};
          var bBox = byUrl[bHref] || {};
          var aDiff = a.dataset.diff || aBox.diff || "";
          var bDiff = b.dataset.diff || bBox.diff || "";
          var difficulty = (rank[bDiff] || 0) - (rank[aDiff] || 0);
          if (difficulty) return difficulty;
          return (b.dataset.date || bBox.date || "").localeCompare(a.dataset.date || aBox.date || "");
        });
        items.forEach(function (item) { board.appendChild(item); });
      });
    }

    /* Sort immediately from the metadata embedded in htb.html, then refresh
       from JSON when available. This prevents the original DOM order from
       flashing before the data request resolves. */
    sortBoards({});

    fetchJSON("data/boxes.json").then(function (boxes) {
      var byUrl = {};
      boxes.forEach(function (box) { byUrl[box.url] = box; });
      sortBoards(byUrl);
    }).catch(function (err) {
      console.error("site.js: board ordering failed:", err);
    });
  }

  /* ---------- HTB box list (htbList.html?os=...) ---------- */

  function initBoxList() {
    var list = $("#boxList");
    if (!list) return;

    var params = new URLSearchParams(window.location.search);
    var os = params.get("os");
    var label = $("#list-label");
    var tools = $("#list-tools");
    var state = {
      sort: params.get("sort") || "difficulty",
      diff: params.get("diff") || ""
    };
    /* Static-first: the boxes are pre-rendered in the HTML (works without JS
       and on file:// where fetch is blocked). Re-render = filter/sort the DOM. */
    var items = $all("li", list).map(function (li) {
      li.classList.add("reveal");
      return li;
    });

    function syncTools() {
      if (!tools) return;
      $all("button[data-sort]", tools).forEach(function (b) {
        var on = b.getAttribute("data-sort") === state.sort;
        b.classList.toggle("is-on", on);
        b.setAttribute("aria-pressed", on ? "true" : "false");
      });
      $all("button[data-diff]", tools).forEach(function (b) {
        var on = b.getAttribute("data-diff") === state.diff;
        b.classList.toggle("is-on", on);
        b.setAttribute("aria-pressed", on ? "true" : "false");
      });
    }

    function pushUrl() {
      var p = new URLSearchParams(window.location.search);
      if (state.sort !== "difficulty") { p.set("sort", state.sort); } else { p.delete("sort"); }
      if (state.diff) { p.set("diff", state.diff); } else { p.delete("diff"); }
      var q = p.toString();
      history.replaceState(null, "", window.location.pathname + (q ? "?" + q : "") + window.location.hash);
    }

    function render() {
      var visible = items.filter(function (li) {
        return !os || li.dataset.os === os;
      });
      if (state.diff) {
        visible = visible.filter(function (li) { return li.dataset.diff === state.diff; });
      }
      visible.sort(function (a, b) {
        if (state.sort === "difficulty") {
          var rank = { easy: 1, medium: 2, hard: 3 };
          return (rank[(b.dataset.diff || "").toLowerCase()] || 0) -
            (rank[(a.dataset.diff || "").toLowerCase()] || 0) ||
            b.dataset.date.localeCompare(a.dataset.date);
        }
        if (state.sort === "name") return a.dataset.name.localeCompare(b.dataset.name);
        if (state.sort === "date-asc") return a.dataset.date.localeCompare(b.dataset.date);
        return b.dataset.date.localeCompare(a.dataset.date);
      });

      items.forEach(function (li) {
        li.style.display = visible.indexOf(li) !== -1 ? "" : "none";
      });
      visible.forEach(function (li) {
        list.appendChild(li); /* re-append in sorted order */
      });

      /* renumber visible rows */
      visible.forEach(function (li, i) {
        var idx = li.querySelector(".idx");
        if (idx) idx.textContent = String(i + 1).padStart(2, "0");
      });

      if (label) {
        var scope = os ? os + " boxes" : "All boxes";
        var n = visible.length;
        var suffix = state.diff ? " · " + state.diff.toLowerCase() : "";
        label.textContent = scope + suffix + " · " + n + " write-up" + (n === 1 ? "" : "s");
      }

      /* Rows are added to the reveal observer after a filter/sort. This
         also keeps them visible when reduced motion is enabled. */
      visible.forEach(observeReveal);
    }

    if (tools) {
      tools.addEventListener("click", function (e) {
        var btn = e.target.closest("button");
        if (!btn) return;
        if (btn.hasAttribute("data-sort")) {
          state.sort = btn.getAttribute("data-sort");
        } else if (btn.hasAttribute("data-diff")) {
          state.diff = btn.getAttribute("data-diff");
        } else {
          return;
        }
        syncTools();
        pushUrl();
        render();
      });
    }

    syncTools();
    render();
  }

  /* ---------- TOC build + scroll-spy ---------- */

  function initToc() {
    var tocList = $("#toc-list");
    var post = $(".post");
    if (!tocList || !post) return;

    /* h2 = top level; h3 nests under the previous h2 (top-level when none);
       h4 nests the same way. Covers both post styles uniformly. */
    var headings = $all("h2, h3, h4", post);
    var links = [];
    var currentTop = null;

    headings.forEach(function (heading, index) {
      if (!heading.id) heading.id = "section-" + index;

      var li = document.createElement("li");
      var a = document.createElement("a");
      a.textContent = heading.textContent;
      a.href = "#" + heading.id;
      li.appendChild(a);

      var tag = heading.tagName;
      var isTop = tag === "H2" || !currentTop;

      if (isTop) {
        tocList.appendChild(li);
        currentTop = li;
      } else {
        var sub = currentTop.querySelector("ul");
        if (!sub) {
          sub = document.createElement("ul");
          currentTop.appendChild(sub);
        }
        sub.appendChild(li);
      }

      links.push({ link: a, heading: heading });
    });

    if (!links.length || !("IntersectionObserver" in window) || reducedMotion.matches) return;

    function activate(target) {
      links.forEach(function (entry) {
        entry.link.classList.toggle("active", entry.heading === target);
      });
    }

    var spy = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            activate(entry.target);
          }
        });
      },
      { rootMargin: "-15% 0px -70% 0px" }
    );

    links.forEach(function (entry) {
      spy.observe(entry.heading);
    });
  }

  /* ---------- Reading progress ---------- */

  function initProgress() {
    var bar = $(".progress");
    if (!bar) return;

    var ticking = false;

    function update() {
      var doc = document.documentElement;
      var max = doc.scrollHeight - window.innerHeight;
      var ratio = max > 0 ? Math.min(window.scrollY / max, 1) : 0;
      bar.style.width = (ratio * 100).toFixed(2) + "%";
      ticking = false;
    }

    window.addEventListener(
      "scroll",
      function () {
        if (!ticking) {
          ticking = true;
          window.requestAnimationFrame(update);
        }
      },
      { passive: true }
    );

    update();
  }

  /* ---------- Crosshair cursor ---------- */

  function initCrosshair() {
    if (reducedMotion.matches) return;
    if (!window.matchMedia("(pointer: fine)").matches) return;

    var v = document.createElement("div");
    var h = document.createElement("div");
    var dot = document.createElement("div");
    var label = document.createElement("div");
    v.className = "xh xh-v";
    h.className = "xh xh-h";
    dot.className = "xh xh-dot";
    label.className = "xh xh-xy";

    function place(el, x, y) {
      var tx = typeof x === "number" ? x + "px" : "0";
      var ty = typeof y === "number" ? y + "px" : "0";
      el.style.transform = "translate(" + tx + "," + ty + ")";
    }

    v.style.transform = "translate(-100px,-100px)";
    h.style.transform = "translate(-100px,-100px)";
    dot.style.transform = "translate(-100px,-100px)";
    label.style.transform = "translate(-200px,-200px)";

    document.body.appendChild(v);
    document.body.appendChild(h);
    document.body.appendChild(dot);
    document.body.appendChild(label);

    var frame = false;
    var mx = 0;
    var my = 0;

    document.addEventListener(
      "pointermove",
      function (e) {
        mx = e.clientX;
        my = e.clientY;
        if (!frame) {
          frame = true;
          window.requestAnimationFrame(function () {
            frame = false;
            place(v, mx, 0);
            place(h, 0, my);
            place(dot, mx - 1, my - 1);
            label.textContent = "X " + Math.round(mx) + " · Y " + Math.round(my);
            place(label, mx + 12, my + 18);
          });
        }
      },
      { passive: true }
    );

    document.addEventListener("pointerleave", function () {
      place(v, -100);
      place(h, 0, -100);
      place(dot, -100, -100);
      place(label, -200, -200);
    });
  }

  /* ---------- Entry details modal (resume) ---------- */

  function initModal() {
    var modal = $("#details-modal");
    if (!modal) return;
    modal.inert = true;

    var card = $(".modal-card", modal);
    var closeBtn = $("[data-modal-close]", modal);
    var kicker = $("#modal-kicker");
    var title = $("#modal-title");
    var meta = $("#modal-meta");
    var desc = $("#modal-desc");
    var skills = $("#modal-skills");
    var link = $("#modal-link");
    var links = $("#modal-links");
    var mapBlock = $("#modal-map");
    var map = null;
    var marker = null;
    var lastFocus = null;

    function referenceIcon(url) {
      var host = "";
      try { host = new URL(url).hostname; } catch (e) {}
      if (host === "nvd.nist.gov") {
        return '<svg class="modal-link-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l7 3v5c0 4.6-3 8.2-7 10-4-1.8-7-5.4-7-10V6l7-3z"/><path d="m9 12 2 2 4-4"/></svg>';
      }
      if (host === "github.com" || host === "raw.githubusercontent.com") {
        return '<svg class="modal-link-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 .7a11.3 11.3 0 0 0-3.6 22c.6.1.8-.3.8-.6v-2.1c-3.2.7-3.9-1.5-3.9-1.5-.5-1.4-1.3-1.8-1.3-1.8-1-.7.1-.7.1-.7 1.1.1 1.7 1.1 1.7 1.1 1 1.7 2.6 1.2 3.3.9.1-.7.4-1.2.7-1.5-2.5-.3-5.1-1.2-5.1-5.4 0-1.2.4-2.1 1.1-2.9-.1-.3-.5-1.4.1-2.9 0 0 .9-.3 3.1 1.1a10.7 10.7 0 0 1 5.7 0c2.2-1.4 3.1-1.1 3.1-1.1.6 1.5.2 2.6.1 2.9.7.8 1.1 1.7 1.1 2.9 0 4.2-2.6 5.1-5.1 5.4.4.3.8 1 .8 2v2.9c0 .3.2.7.8.6A11.3 11.3 0 0 0 12 .7z"/></svg>';
      }
      return '<svg class="modal-link-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4h6v6M20 4l-9 9"/><path d="M18 13v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h5"/></svg>';
    }

    /* Themed map (Leaflet + Esri dark basemap) with a photo pin, shown
       only for entries that carry a "pin" payload. */
    function renderPin(pin) {
      if (!mapBlock) return;
      var hasLocation = !!pin;

      /* Only reserve the second grid column when a map will be shown. */
      var card = mapBlock.closest(".modal-card");
      if (card) {
        card.classList.toggle("no-map", !hasLocation || typeof L === "undefined");
      }

      if (!hasLocation || typeof L === "undefined") {
        mapBlock.hidden = true;
        return;
      }

      mapBlock.hidden = false;

      /* Pin geometry must match the CSS .map-pin box exactly:
         36×36 border-box + 7px tail below, anchored at the tail tip. */
      if (!map) {
        map = L.map(mapBlock, { scrollWheelZoom: false, keyboard: false });
        L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}", {
          maxZoom: 19,
          attribution: "Map data &copy; <a href=\"https://www.openstreetmap.org/copyright\">OpenStreetMap</a> contributors, tiles &copy; Esri"
        }).addTo(map);
        L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}", {
          maxZoom: 19,
          opacity: 0.55
        }).addTo(map);
      }

      if (marker) marker.remove();
      marker = L.marker([pin.lat, pin.lng], {
        icon: L.divIcon({
          className: "",
          html: '<span class="map-pin"><img src="' + pin.img + '" alt="' + (pin.alt || "") + '"></span>',
          iconSize: [36, 36],
          iconAnchor: [18, 43]
        }),
        title: pin.alt || ""
      }).addTo(map);

      map.setView([pin.lat, pin.lng], pin.zoom || 15);
      window.setTimeout(function () {
        if (map) map.invalidateSize();
      }, 280);
    }

    function openFrom(el) {
      var data;
      try {
        data = JSON.parse(el.getAttribute("data-details"));
      } catch (e) {
        console.error("site.js: invalid data-details", e);
        return;
      }

      kicker.textContent = data.kicker || "";
      title.textContent = data.title || "";
      meta.textContent = data.meta || "";
      desc.textContent = data.desc || "";

      skills.innerHTML = "";
      (data.skills || []).forEach(function (s) {
        var li = document.createElement("li");
        li.textContent = s;
        skills.appendChild(li);
      });

      if (data.link && data.link.url) {
        link.setAttribute("href", data.link.url);
        link.textContent = data.link.label || "Official link";
        link.removeAttribute("hidden");
      } else {
        link.removeAttribute("href");
        link.textContent = "";
        link.setAttribute("hidden", "");
      }

      if (links) {
        links.innerHTML = "";
        (data.links || []).forEach(function (l) {
          if (!l || !l.url) return;
          var a = document.createElement("a");
          a.className = "tlink";
          a.setAttribute("href", l.url);
          a.setAttribute("target", "_blank");
          a.setAttribute("rel", "noopener noreferrer");
          a.insertAdjacentHTML("beforeend", referenceIcon(l.url));
          var label = document.createElement("span");
          label.textContent = l.label || "Reference";
          a.appendChild(label);
          links.appendChild(a);
        });
      }

      renderPin(data.pin);

      lastFocus = el;
      modal.inert = false;
      modal.classList.add("open");
      modal.setAttribute("aria-hidden", "false");
      document.body.style.overflow = "hidden";
      if (closeBtn) closeBtn.focus();
    }

    function close() {
      modal.classList.remove("open");
      modal.inert = true;
      modal.setAttribute("aria-hidden", "true");
      document.body.style.overflow = "";
      if (lastFocus) {
        lastFocus.focus();
        lastFocus = null;
      }
    }

    $all("[data-details]").forEach(function (el) {
      el.setAttribute("tabindex", "0");
      el.setAttribute("role", "button");
      el.setAttribute("aria-haspopup", "dialog");
      el.addEventListener("click", function (e) {
        /* Let real links/buttons inside the card do their own thing. */
        if (e.target.closest("a[href], button")) return;
        openFrom(el);
      });
      el.addEventListener("keydown", function (e) {
        if (e.target !== el) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          openFrom(el);
        }
      });
    });

    if (closeBtn) {
      closeBtn.addEventListener("click", close);
    }

    modal.addEventListener("click", function (e) {
      if (e.target === modal) close();
    });

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && modal.classList.contains("open")) close();
    });

    /* Tab stays inside the dialog while open */
    modal.addEventListener("keydown", function (e) {
      if (e.key !== "Tab" || !modal.classList.contains("open")) return;
      var focusable = $all('a[href], button:not([disabled])', card);
      if (!focusable.length) return;
      var first = focusable[0];
      var last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    });
  }

  /* ---------- Field-note modal (resume: Other Experiences) ----------
     A compact second dialog, deliberately lighter than #details-modal:
     same inert/Escape/backdrop/focus-trap contract, smaller card. */

  function initExpModal() {
    var modal = $("#exp-modal");
    if (!modal) return;
    modal.inert = true;

    var card = $(".xmodal-card", modal);
    var closeBtn = $("[data-exp-close]", modal);
    var tag = $("#exp-modal-tag");
    var title = $("#exp-modal-title");
    var year = $("#exp-modal-year");
    var body = $("#exp-modal-body");
    var topics = $("#exp-modal-topics");
    var link = $("#exp-modal-link");
    var lastFocus = null;

    function openFrom(el) {
      var data;
      try {
        data = JSON.parse(el.getAttribute("data-exp"));
      } catch (e) {
        console.error("site.js: invalid data-exp", e);
        return;
      }

      tag.textContent = data.tag ? "Field note · " + data.tag : "Field note";
      title.textContent = data.title || "";
      year.textContent = data.year || "";

      body.innerHTML = "";
      var paras = Array.isArray(data.body) ? data.body : [data.body];
      paras.forEach(function (text) {
        if (!text) return;
        var p = document.createElement("p");
        p.textContent = text;
        body.appendChild(p);
      });

      topics.innerHTML = "";
      (data.topics || []).forEach(function (t) {
        var li = document.createElement("li");
        li.textContent = t;
        topics.appendChild(li);
      });

      if (data.link && data.link.url) {
        link.setAttribute("href", data.link.url);
        link.textContent = data.link.label || "Source";
        link.removeAttribute("hidden");
      } else {
        link.setAttribute("hidden", "");
      }

      lastFocus = el;
      modal.inert = false;
      modal.classList.add("open");
      modal.setAttribute("aria-hidden", "false");
      document.body.style.overflow = "hidden";
      if (closeBtn) closeBtn.focus();
    }

    function close() {
      modal.classList.remove("open");
      modal.inert = true;
      modal.setAttribute("aria-hidden", "true");
      document.body.style.overflow = "";
      if (lastFocus) {
        lastFocus.focus();
        lastFocus = null;
      }
    }

    $all("[data-exp]").forEach(function (el) {
      el.addEventListener("click", function () {
        openFrom(el);
      });
    });

    if (closeBtn) {
      closeBtn.addEventListener("click", close);
    }

    modal.addEventListener("click", function (e) {
      if (e.target === modal) close();
    });

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && modal.classList.contains("open")) close();
    });

    /* Tab stays inside the dialog while open */
    modal.addEventListener("keydown", function (e) {
      if (e.key !== "Tab" || !modal.classList.contains("open")) return;
      var focusable = $all('a[href], button:not([disabled])', card);
      if (!focusable.length) return;
      var first = focusable[0];
      var last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    });
  }

  /* ---------- Estimated read time ---------- */

  function initReadTime() {
    $all("[data-read-time-auto]").forEach(function (el) {
      var post = el.closest(".post");
      if (!post) return;
      /* Count the article body only — the breadcrumb link is chrome,
         not prose. Everything else (captions, toggles, code) stays in. */
      var clone = post.cloneNode(true);
      var crumb = clone.querySelector(".crumb");
      if (crumb) crumb.remove();
      var words = clone.textContent.trim().split(/\s+/).filter(Boolean).length;
      var mins = Math.max(1, Math.round(words / 200));
      el.textContent =
        "≈ " + mins + " min · " + words.toLocaleString("en-US") + " words";
    });
  }

  /* ---------- Scroll hint ---------- */

  function initScrollHint() {
    var placeholder = $("[data-scroll-hint]");
    if (!placeholder) return;

    /* Pages ship an empty, hidden [data-scroll-hint] node: it stays inert
       without JS. Upgrade it to a real button here so no page needs its own
       copy of the markup. */
    var hint = placeholder;
    if (hint.tagName !== "BUTTON") {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = hint.className;
      btn.setAttribute("data-scroll-hint", "");
      hint.parentNode.replaceChild(btn, hint);
      hint = btn;
    }
    hint.removeAttribute("aria-hidden");
    hint.hidden = false;
    hint.setAttribute("aria-label", "Scroll to the next section");
    hint.innerHTML =
      '<span class="sh-track" aria-hidden="true"><span class="sh-dot"></span></span>' +
      '<span class="sh-label">Scroll to explore</span>' +
      '<svg class="sh-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>';

    /* Visibility is driven by the real remaining scroll distance, not by a
       fixed point on the page: the button stays while meaningful content is
       still below the viewport and leaves when the end is reached. */
    function update() {
      var doc = document.documentElement;
      var viewport = window.innerHeight;
      var pageHeight = doc.scrollHeight;
      var remaining = pageHeight - window.scrollY - viewport;
      var threshold = Math.max(72, viewport * 0.12);
      var canScroll = pageHeight - viewport > threshold;
      var show = canScroll && remaining > threshold;

      hint.classList.toggle("show", show);
      /* The faded-out state is still in the DOM: keep it out of the tab order
         and the accessibility tree so nobody lands on an invisible control. */
      hint.inert = !show;
      hint.tabIndex = show ? 0 : -1;
      hint.setAttribute("aria-hidden", show ? "false" : "true");
    }

    var ticking = false;
    var timer = 0;

    /* rAF-throttled, with a timeout fallback so the state also settles in
       throttled/background tabs where animation frames stall. */
    function schedule() {
      if (ticking) return;
      ticking = true;
      window.clearTimeout(timer);
      timer = window.setTimeout(run, 120);
      window.requestAnimationFrame(run);
    }

    function run() {
      if (!ticking) return;
      ticking = false;
      window.clearTimeout(timer);
      update();
    }

    /* Next stop: the first substantial block below the fold, so the button
       advances to real content instead of a fixed number of pixels. */
    function nextStop() {
      var max = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
      var topbar = $(".topbar");
      var barShown = topbar && window.getComputedStyle(topbar).display !== "none";
      var inset = (barShown ? topbar.offsetHeight : 0) + 16;
      var fold = window.scrollY + window.innerHeight * 0.86;
      var best = null;

      $all(".post > *, main > *").forEach(function (el) {
        var rect = el.getBoundingClientRect();
        if (rect.height < 24) return;
        var top = rect.top + window.scrollY;
        if (top <= fold) return;
        if (best === null || top < best) best = top;
      });

      if (best === null) best = window.scrollY + window.innerHeight * 0.85;
      /* Always move forward a useful amount, never past the document end. */
      var minTop = window.scrollY + window.innerHeight * 0.45;
      return Math.min(max, Math.max(minTop, best - inset));
    }

    hint.addEventListener("click", function () {
      window.scrollTo({
        top: nextStop(),
        behavior: reducedMotion.matches ? "auto" : "smooth"
      });
    });

    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    window.addEventListener("load", schedule);
    window.addEventListener("pageshow", function () {
      window.setTimeout(schedule, 60);
    });
    /* Re-measure when content height changes (images finishing, filters). */
    if ("ResizeObserver" in window) {
      new ResizeObserver(schedule).observe(document.body);
    }

    update();
  }

  /* ---------- Image viewer (lightbox) ---------- */

  function captionNode(img) {
    var fig = img.closest("figure");
    return fig ? $("figcaption", fig) : null;
  }

  function captionFor(img) {
    var cap = captionNode(img);
    var text = cap ? cap.textContent.replace(/\s+/g, " ").trim() : "";
    return text || img.getAttribute("alt") || "";
  }

  function initLightbox() {
    /* Blog posts, projects and HTB write-ups all render their images in
       .post figure, so one viewer covers every content type. */
    var images = $all(".post figure img").filter(function (img) {
      /* Leave images that are already links, and Notion inline icons, alone. */
      if (img.closest("a[href]")) return false;
      if (img.classList.contains("icon")) return false;
      /* Bookmark cards build their own favicon <img>; it is chrome, not
         article media, and must not become a lightbox target. */
      if (img.closest("figure.bookmark")) return false;
      return true;
    });
    if (!images.length) return;

    var box = document.createElement("div");
    box.id = "lightbox";
    box.className = "lightbox";
    box.setAttribute("role", "dialog");
    box.setAttribute("aria-modal", "true");
    box.setAttribute("aria-label", "Image viewer");
    box.setAttribute("aria-hidden", "true");
    box.inert = true;
    box.innerHTML =
      '<button class="lb-close" type="button" data-lb-close aria-label="Close image viewer">&#215;</button>' +
      '<figure class="lb-figure">' +
      '<img class="lb-img" alt="">' +
      '<figcaption class="lb-cap" hidden></figcaption>' +
      "</figure>";
    document.body.appendChild(box);

    var viewImg = $(".lb-img", box);
    var viewCap = $(".lb-cap", box);
    var closeBtn = $("[data-lb-close]", box);
    var lastFocus = null;

    function open(img) {
      var capEl = captionNode(img);
      var hasCaption = !!(capEl && capEl.textContent.trim());

      viewImg.setAttribute("src", img.currentSrc || img.src);
      viewImg.setAttribute("alt", img.getAttribute("alt") || "");

      /* Clone the caption's content (not the element itself) so any links
         inside it stay usable in the viewer. */
      viewCap.innerHTML = "";
      if (hasCaption) {
        Array.prototype.slice.call(capEl.childNodes).forEach(function (node) {
          viewCap.appendChild(node.cloneNode(true));
        });
      } else if (img.getAttribute("alt")) {
        viewCap.textContent = img.getAttribute("alt");
      }
      viewCap.hidden = !viewCap.textContent.trim();

      lastFocus = img;
      box.inert = false;
      box.classList.add("open");
      box.setAttribute("aria-hidden", "false");
      document.body.style.overflow = "hidden";
      if (closeBtn) closeBtn.focus();
    }

    function close() {
      box.classList.remove("open");
      box.inert = true;
      box.setAttribute("aria-hidden", "true");
      document.body.style.overflow = "";
      if (lastFocus) {
        lastFocus.focus();
        lastFocus = null;
      }
    }

    images.forEach(function (img) {
      var label = captionFor(img);
      img.setAttribute("data-lightbox", "");
      img.setAttribute("role", "button");
      img.setAttribute("tabindex", "0");
      img.setAttribute("aria-haspopup", "dialog");
      img.setAttribute(
        "aria-label",
        label ? "View larger image: " + label.slice(0, 140) : "View larger image"
      );

      img.addEventListener("click", function () {
        open(img);
      });
      img.addEventListener("keydown", function (e) {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          open(img);
        }
      });
    });

    if (closeBtn) closeBtn.addEventListener("click", close);

    /* Backdrop click closes; the image and its caption never do. */
    box.addEventListener("click", function (e) {
      if (e.target === box) close();
    });

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && box.classList.contains("open")) close();
    });

    /* Tab stays inside the viewer (close button, plus any caption link). */
    box.addEventListener("keydown", function (e) {
      if (e.key !== "Tab" || !box.classList.contains("open")) return;
      var focusable = $all('a[href], button:not([disabled])', box);
      if (!focusable.length) return;
      var first = focusable[0];
      var last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    });
  }

  /* ---------- Animated background (WebGL circuit flyover) ----------
     A single full-screen fragment shader paints a restrained perspective
     circuit grid with flowing data pulses, atmospheric dust and a soft
     horizon.
     Dependency-free. Falls back silently to the static schematic SVG
     when WebGL is unavailable. Under prefers-reduced-motion it renders
     one static frame (no loop). Colours track the theme.
     Every time-dependent term is phase-wrapped with fract()/mod() and
     the travel coordinate is bounded: without that, float precision
     degrades over a long session. */

  function parseColor(str) {
    if (!str) return null;
    str = str.trim();
    var m;
    if (str.charAt(0) === "#") {
      var hex = str.slice(1);
      if (hex.length === 3) {
        hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
      }
      if (hex.length < 6) return null;
      return [
        parseInt(hex.slice(0, 2), 16) / 255,
        parseInt(hex.slice(2, 4), 16) / 255,
        parseInt(hex.slice(4, 6), 16) / 255
      ];
    }
    m = str.match(/rgba?\(([^)]+)\)/);
    if (m) {
      var p = m[1].split(",");
      return [
        parseFloat(p[0]) / 255,
        parseFloat(p[1]) / 255,
        parseFloat(p[2]) / 255
      ];
    }
    return null;
  }

  var BG_VERT =
    "attribute vec2 aPos;void main(){gl_Position=vec4(aPos,0.0,1.0);}";

  var BG_FRAG = [
    "#ifdef GL_FRAGMENT_PRECISION_HIGH",
    "precision highp float;",
    "#else",
    "precision mediump float;",
    "#endif",
     "uniform float uTime;uniform vec2 uRes;uniform vec3 uBg;uniform vec3 uAccent;uniform float uLight;uniform float uMotion;",
    "float h21(vec2 p){p=fract(p*vec2(234.34,435.345));p+=dot(p,p+34.23);return fract(p.x*p.y);}",
    "vec3 circuit(vec2 p,float t){",
    "  vec3 bg=uBg;vec3 ac=uAccent;vec3 c=bg;",
    "  vec2 id=mod(floor(p),64.0);vec2 f=fract(p);",
    "  float w=0.03;",
    "  float dv=min(f.x,1.0-f.x);float dh=min(f.y,1.0-f.y);",
     "  float mv=step(0.5,h21(id+vec2(0.0,7.0)));",
     "  float mh=step(0.5,h21(id+vec2(3.0,0.0)));",
     "  float mvPrev=step(0.5,h21(vec2(id.x,mod(id.y-1.0,64.0))+vec2(0.0,7.0)));",
     "  float mvNext=step(0.5,h21(vec2(id.x,mod(id.y+1.0,64.0))+vec2(0.0,7.0)));",
     "  float mhPrev=step(0.5,h21(vec2(mod(id.x-1.0,64.0),id.y)+vec2(3.0,0.0)));",
     "  float mhNext=step(0.5,h21(vec2(mod(id.x+1.0,64.0),id.y)+vec2(3.0,0.0)));",
     "  float vFade=mix(1.0,smoothstep(0.0,0.12,f.y),1.0-mvPrev)*mix(1.0,1.0-smoothstep(0.88,1.0,f.y),1.0-mvNext);",
     "  float hFade=mix(1.0,smoothstep(0.0,0.12,f.x),1.0-mhPrev)*mix(1.0,1.0-smoothstep(0.88,1.0,f.x),1.0-mhNext);",
     "  float lv=smoothstep(w,0.0,dv)*mv*vFade;float lh=smoothstep(w,0.0,dh)*mh*hFade;",
    "  float line=max(lv,lh);",
    "  vec3 traceCol=mix(ac,vec3(0.16,0.16,0.18),uLight);",
    "  c=mix(c,traceCol,line*(0.08+0.14*uLight));",
     "  float core=max(smoothstep(w*0.45,0.0,dv)*mv*vFade,smoothstep(w*0.45,0.0,dh)*mh*hFade);",
    "  c+=ac*core*(0.05*(1.0-uLight)+0.04);",
    "  float pv=pow(0.5+0.5*sin(6.2831*fract(p.y-t*1.3)),18.0);",
     "  c+=ac*smoothstep(w,0.0,dv)*mv*vFade*pv*(0.2*(1.0-uLight)+0.24);",
    "  float ph=pow(0.5+0.5*sin(6.2831*fract(p.x+t*1.0)),18.0);",
     "  c+=ac*smoothstep(w,0.0,dh)*mh*hFade*ph*(0.15*(1.0-uLight)+0.2);",
    "  vec2 cc=min(f,1.0-f);float dc=length(cc);",
    "  float vmask=step(0.78,h21(id+vec2(5.0,5.0)));",
    "  float via=smoothstep(0.10,0.0,dc)*vmask;",
    "  float pulse=0.5+0.5*sin(6.2831*fract(t*0.63662)+h21(id)*6.2831);",
    "  c+=ac*via*(0.4+0.6*pulse)*(0.13*(1.0-uLight)+0.18);",
    "  return c;",
    "}",
    "vec3 scene(vec2 uv,float t){",
     "  vec3 ro=vec3(0.0,1.28,mod(t*0.65,71.1111));",
     "  vec3 ta=ro+vec3(0.0,-0.4,1.0);",
    "  vec3 fwd=normalize(ta-ro);",
    "  vec3 rgt=normalize(cross(vec3(0.0,1.0,0.0),fwd));",
    "  vec3 up=cross(fwd,rgt);",
    "  vec3 rd=normalize(uv.x*rgt+uv.y*up+1.35*fwd);",
    "  vec3 bg=uBg;vec3 ac=uAccent;vec3 col=bg;",
    "  if(rd.y<-0.0015){",
    "    float td=-ro.y/rd.y;",
    "    vec3 pos=ro+td*rd;",
     "    vec2 p=pos.xz*0.9;",
     "    vec3 cir=circuit(p,t);",
     "    float fog=exp(-td*0.105);",
    "    col=mix(bg,cir,clamp(fog,0.0,1.0));",
    "  }else{",
    "    float k=clamp(rd.y*2.0,0.0,1.0);",
    "    col=mix(bg,bg*(0.7+0.3*uLight),k);",
    "  }",
     "  float horizon=smoothstep(0.16,0.0,abs(rd.y))*exp(-abs(uv.x)*0.7);",
     "  col+=mix(ac,vec3(0.45),uLight)*horizon*(0.06+0.04*(1.0-uLight));",
     "  vec2 dustUv=uv*vec2(42.0,25.0)+vec2(t*0.012,-t*0.006);",
     "  vec2 dustCell=floor(dustUv);vec2 dustFr=fract(dustUv)-0.5;",
     "  float dust=step(0.992,h21(dustCell+vec2(7.0,19.0)))*smoothstep(0.42,0.0,length(dustFr));",
     "  col+=mix(ac,vec3(0.55),uLight)*dust*(0.035+0.025*uLight)*uMotion;",
     "  return col;",
    "}",
    "void main(){",
    "  vec2 frag=gl_FragCoord.xy;",
    "  vec2 uv=(frag-0.5*uRes)/uRes.y;",
     "  float t=uTime*uMotion;",
    "  vec3 col=scene(uv,t);",
    "  float scan=0.92+0.08*sin(frag.y*3.14159+6.2831*fract(t*0.31831));",
    "  col*=mix(1.0,scan,0.5*(1.0-uLight));",
     "  gl_FragColor=vec4(col,1.0);",
    "}"
  ].join("\n");

  function initBackground() {
    var canvas = document.createElement("canvas");
    canvas.className = "bg-canvas";
    canvas.setAttribute("aria-hidden", "true");

    var gl;
    try {
      gl =
        canvas.getContext("webgl", { antialias: false, alpha: false }) ||
        canvas.getContext("experimental-webgl", { antialias: false, alpha: false });
    } catch (e) {
      gl = null;
    }
    if (!gl) return; /* keep the static SVG fallback */

    function compile(type, src) {
      var s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        gl.deleteShader(s);
        return null;
      }
      return s;
    }

    var vs = compile(gl.VERTEX_SHADER, BG_VERT);
    var fs = compile(gl.FRAGMENT_SHADER, BG_FRAG);
    if (!vs || !fs) {
      if (vs) gl.deleteShader(vs);
      if (fs) gl.deleteShader(fs);
      return;
    }

    var prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      gl.deleteProgram(prog);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      return;
    }
    gl.deleteShader(vs);
    gl.deleteShader(fs);

    /* WebGL is good: mount the canvas and hide the static SVG. */
    document.body.insertBefore(canvas, document.body.firstChild);
    document.documentElement.classList.add("webgl-bg");

    gl.useProgram(prog);
    var buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 3, -1, -1, 3]),
      gl.STATIC_DRAW
    );
    var aPos = gl.getAttribLocation(prog, "aPos");
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    var uTime = gl.getUniformLocation(prog, "uTime");
    var uRes = gl.getUniformLocation(prog, "uRes");
    var uBg = gl.getUniformLocation(prog, "uBg");
    var uAccent = gl.getUniformLocation(prog, "uAccent");
    var uLight = gl.getUniformLocation(prog, "uLight");
    var uMotion = gl.getUniformLocation(prog, "uMotion");

    var dpr = Math.min(window.devicePixelRatio || 1, 1.35);
    var scale = window.innerWidth < 700 ? 0.68 : 0.8;
    var contextLost = false;

    function readTheme() {
      if (contextLost) return;
      var cs = getComputedStyle(document.documentElement);
      var bg = parseColor(cs.getPropertyValue("--bg")) || [0.055, 0.063, 0.08];
      var ac = parseColor(cs.getPropertyValue("--accent")) || [1.0, 1.0, 1.0];
      var light =
        document.documentElement.getAttribute("data-theme") === "light" ? 1 : 0;
      gl.uniform3f(uBg, bg[0], bg[1], bg[2]);
      gl.uniform3f(uAccent, ac[0], ac[1], ac[2]);
      gl.uniform1f(uLight, light);
    }

    function resize() {
      if (contextLost) return;
      var w = Math.max(1, Math.floor(window.innerWidth * dpr * scale));
      var h = Math.max(1, Math.floor(window.innerHeight * dpr * scale));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.uniform2f(uRes, canvas.width, canvas.height);
    }

    var staticMode = reducedMotion.matches;
    gl.uniform1f(uMotion, staticMode ? 0 : 1);
    readTheme();
    resize();

    function draw(tSec) {
      if (contextLost) return;
      gl.uniform1f(uTime, tSec);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    var running = false;
    var rafId = 0;
    var start = 0;

    function loop(now) {
      if (!running) return;
      if (!start) start = now;
      draw((now - start) / 1000);
      rafId = requestAnimationFrame(loop);
    }

    function startLoop() {
      if (running || staticMode) return;
      running = true;
      start = 0;
      rafId = requestAnimationFrame(loop);
    }

    function stopLoop() {
      running = false;
      if (rafId) cancelAnimationFrame(rafId);
    }

    function renderStatic() {
      resize();
      draw(8.0); /* a pleasing fixed moment */
    }

    if (staticMode) {
      renderStatic();
    } else {
      startLoop();
    }

    /* Pause while the tab is hidden to save battery. */
    document.addEventListener("visibilitychange", function () {
      if (document.hidden) {
        stopLoop();
      } else if (!staticMode) {
        startLoop();
      }
    });

    window.addEventListener("resize", function () {
      dpr = Math.min(window.devicePixelRatio || 1, 1.35);
      scale = window.innerWidth < 700 ? 0.68 : 0.8;
      resize();
      if (staticMode) renderStatic();
    });

    canvas.addEventListener("webglcontextlost", function (e) {
      e.preventDefault();
      contextLost = true;
      stopLoop();
      canvas.remove();
      document.documentElement.classList.remove("webgl-bg");
    });

    /* React to theme toggles. */
    new MutationObserver(function () {
      readTheme();
      if (staticMode) renderStatic();
    }).observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"]
    });

    /* React to users switching the reduced-motion preference live. */
    if (reducedMotion.addEventListener) {
      reducedMotion.addEventListener("change", function (e) {
        staticMode = e.matches;
        gl.uniform1f(uMotion, staticMode ? 0 : 1);
        if (staticMode) {
          stopLoop();
          renderStatic();
        } else {
          startLoop();
        }
      });
    }
  }

  /* ---------- Boot ---------- */

  /* Writing page: category chips toggle the cards' `hidden` state. The
     active category is mirrored to ?cat= so a filtered view can be linked. */
  function initWritingFilter() {
    var bar = $("[data-filter-bar]");
    if (!bar) return;
    var chips = $all("[data-filter]", bar);
    var cards = $all(".blog-card[data-cat]");

    function apply(cat, push) {
      if (!chips.some(function (c) { return c.getAttribute("data-filter") === cat; })) cat = "all";
      chips.forEach(function (c) {
        c.setAttribute("aria-pressed", String(c.getAttribute("data-filter") === cat));
      });
      cards.forEach(function (card) {
        card.hidden = cat !== "all" && card.getAttribute("data-cat") !== cat;
      });
      if (push && window.history && history.replaceState) {
        var url = location.pathname + (cat === "all" ? "" : "?cat=" + cat) + location.hash;
        try { history.replaceState(null, "", url); } catch (e) { /* file:// or sandboxed */ }
      }
    }

    chips.forEach(function (chip) {
      chip.addEventListener("click", function () {
        apply(chip.getAttribute("data-filter"), true);
      });
    });

    var match = /[?&]cat=([a-z]+)/.exec(location.search);
    apply(match ? match[1] : "all", false);
  }

  function init() {
    initBackground();
    initTheme();
    initFavicon();
    initMenu();
    initModal();
    initExpModal();
    initSpine();
    initPostPanels();
    initHtbReferences();
    initTypewriters();
    initBareUrls();
    initBookmarks();
    initReveals();
    initYears();
    initCounters();
    initBoardSort();
    initBoxList();
    initToc();
    initReadTime();
    initTimelineResizeSync();
    initProgress();
    initCrosshair();
    initScrollHint();
    initLightbox();
    initWritingFilter();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
