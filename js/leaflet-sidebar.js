// leaflet-sidebar.js
// @ts-nocheck

L.Control.Sidebar = L.Control.extend({
  includes: L.Evented ? L.Evented.prototype : L.Mixin.Events,

  options: {
    autopan: true,
    closeButton: true,
    container: null,
    position: "left",

    bottomsheetMaxWidth: 991,
    bottomsheetPeekRatio: 0.22, 
    bottomsheetFullRatio: 1.0,
    bottomsheetTopGapPx: 0
  },

  initialize: function (options, deprecatedOptions) {
    if (typeof options === "string") {
      console.warn("Deprecated syntax. Use L.control.sidebar({ container })");
      options = { container: options };
    }
    if (typeof options === "object" && options.id) {
      console.warn("Deprecated syntax. Use L.control.sidebar({ container })");
      options.container = options.id;
    }

    this._tabitems = [];
    this._panes = [];
    this._closeButtons = [];
    this._current = null;

    this._isBottomsheet = false;
    this._bs = {
      state: "peek", // 'peek' , 'full'
      y: null,
      minY: 0,
      maxY: 0,
      peekY: 0,
      fullY: 0,
      dragging: false,
      startY: 0,
      startSheetY: 0,
      lastY: 0,
      lastT: 0,
      vel: 0
    };

    L.setOptions(this, options);
    L.setOptions(this, deprecatedOptions);
    return this;
  },

  onAdd: function (map) {
    var i, child, tabContainers, newContainer, container;

    container =
      this._container ||
      (typeof this.options.container === "string"
        ? L.DomUtil.get(this.options.container)
        : this.options.container);

    if (!container) {
      container = L.DomUtil.create("div", "leaflet-sidebar collapsed");
      if (typeof this.options.container === "string") container.id = this.options.container;
    }

    this._paneContainer =
      container.querySelector("div.leaflet-sidebar-content") ||
      L.DomUtil.create("div", "leaflet-sidebar-content", container);

    tabContainers = container.querySelectorAll("ul.leaflet-sidebar-tabs, div.leaflet-sidebar-tabs > ul");
    this._tabContainerTop = tabContainers[0] || null;
    this._tabContainerBottom = tabContainers[1] || null;

    if (!this._tabContainerTop) {
      newContainer = L.DomUtil.create("div", "leaflet-sidebar-tabs", container);
      newContainer.setAttribute("role", "tablist");
      this._tabContainerTop = L.DomUtil.create("ul", "", newContainer);
    }
    if (!this._tabContainerBottom) {
      newContainer = this._tabContainerTop.parentNode;
      this._tabContainerBottom = L.DomUtil.create("ul", "", newContainer);
    }

    this._tabitems = [];
    for (i = 0; i < this._tabContainerTop.children.length; i++) {
      child = this._tabContainerTop.children[i];
      child._sidebar = this;
      var aTop = child.querySelector("a");
      if (!aTop || !aTop.hash) continue;
      child._id = aTop.hash.slice(1);
      this._tabitems.push(child);
    }
    for (i = 0; i < this._tabContainerBottom.children.length; i++) {
      child = this._tabContainerBottom.children[i];
      child._sidebar = this;
      var aBot = child.querySelector("a");
      if (!aBot || !aBot.hash) continue;
      child._id = aBot.hash.slice(1);
      this._tabitems.push(child);
    }

    this._panes = [];
    this._closeButtons = [];
    for (i = 0; i < this._paneContainer.children.length; i++) {
      child = this._paneContainer.children[i];
      if (child.tagName === "DIV" && L.DomUtil.hasClass(child, "leaflet-sidebar-pane")) {
        this._panes.push(child);
        var closeButtons = child.querySelectorAll(".leaflet-sidebar-close");
        if (closeButtons.length) {
          var btn = closeButtons[closeButtons.length - 1];
          this._closeButtons.push(btn);
          this._closeClick(btn, "on");
        }
      }
    }

    for (i = 0; i < this._tabitems.length; i++) this._tabClick(this._tabitems[i], "on");

    this._ensureBottomsheetChrome(container);

    return container;
  },

  onRemove: function () {
    for (var i = 0; i < this._tabitems.length; i++) this._tabClick(this._tabitems[i], "off");
    for (var j = 0; j < this._closeButtons.length; j++) this._closeClick(this._closeButtons[j], "off");
    this._tabitems = [];
    this._panes = [];
    this._closeButtons = [];
    this._teardownBottomsheetListeners();
    return this;
  },

  addTo: function (map) {
    this.onRemove();
    this._map = map;

    this._container = this.onAdd(map);

    L.DomUtil.addClass(this._container, "leaflet-control");
    L.DomUtil.addClass(this._container, "leaflet-sidebar-" + this.getPosition());
    if (L.Browser.touch) L.DomUtil.addClass(this._container, "leaflet-touch");

    L.DomEvent.disableScrollPropagation(this._container);
    L.DomEvent.disableClickPropagation(this._container);
    L.DomEvent.on(this._container, "contextmenu", L.DomEvent.stopPropagation);

    map._container.insertBefore(this._container, map._container.firstChild);

    this._applyResponsiveMode();
    this._wireResizeListener();

    return this;
  },

  removeFrom: function (map) {
    console.warn("removeFrom() is deprecated, use remove()");
    this._map._container.removeChild(this._container);
    this.onRemove(map);
    return this;
  },

  getPosition: function () {
    return this.options.position;
  },

  open: function (id) {
    var i, child;

    this._current = id;

    var tab = null;
    try {
      tab = this._getTab(id);
      if (tab && L.DomUtil.hasClass(tab, "disabled")) return this;
    } catch (e) {
      tab = null;
    }

    for (i = 0; i < this._panes.length; i++) {
      child = this._panes[i];
      L.DomUtil[child.id === id ? "addClass" : "removeClass"](child, "active");
    }

    for (i = 0; i < this._tabitems.length; i++) {
      child = this._tabitems[i];
      var link = child.querySelector("a");
      var isActive = link && link.hash === "#" + id;
      L.DomUtil[isActive ? "addClass" : "removeClass"](child, "active");
    }

    this.fire("content", { id: id });

    if (this._isBottomsheet) {
      // project info forces FULL
      if (id === "pane-projectInfo") this._bsSnapTo("full", true);
      else if (this._bs.state === "peek") this._bsSnapTo("full", true);

      this._updateMapButtonVisibility();
      return this;
    }

    if (L.DomUtil.hasClass(this._container, "collapsed")) {
      this.fire("opening");
      L.DomUtil.removeClass(this._container, "collapsed");
      if (this.options.autopan) this._panMap("open");
    }

    return this;
  },

  close: function () {
    if (this._isBottomsheet) {
      this._bsSnapTo("peek", true);
      this._updateMapButtonVisibility();
      return this;
    }

    if (!L.DomUtil.hasClass(this._container, "collapsed")) {
      this.fire("closing");
      L.DomUtil.addClass(this._container, "collapsed");
      if (this.options.autopan) this._panMap("close");
    }
    return this;
  },

  addPanel: function (data) {
    var pane, tab, tabHref, closeButtons, content;

    if (!data.skipTab) {
      tab = L.DomUtil.create("li", data.disabled ? "disabled" : "");
      tabHref = L.DomUtil.create("a", "", tab);
      tabHref.href = "#" + data.id;
      tabHref.setAttribute("role", "tab");
      tabHref.innerHTML = data.tab || "";
      tab._sidebar = this;
      tab._id = data.id;
      tab._button = data.button;
      if (data.title && data.title[0] !== "<") tab.title = data.title;

      if (data.position === "bottom") this._tabContainerBottom.appendChild(tab);
      else this._tabContainerTop.appendChild(tab);

      this._tabitems.push(tab);
      this._tabClick(tab, "on");
    }

    if (data.pane) {
      if (typeof data.pane === "string") {
        pane = L.DomUtil.create("div", "leaflet-sidebar-pane", this._paneContainer);
        content = "";
        if (data.title) content += '<h1 class="leaflet-sidebar-header">' + data.title;
        if (this.options.closeButton)
          content +=
            '<span class="leaflet-sidebar-close"><i class="fa fa-caret-' +
            this.options.position +
            '"></i></span>';
        if (data.title) content += "</h1>";
        pane.innerHTML = content + data.pane;
      } else {
        pane = data.pane;
        this._paneContainer.appendChild(pane);
      }
      pane.id = data.id;

      this._panes.push(pane);

      closeButtons = pane.querySelectorAll(".leaflet-sidebar-close");
      if (closeButtons.length) {
        var btn = closeButtons[closeButtons.length - 1];
        this._closeButtons.push(btn);
        this._closeClick(btn, "on");
      }
    }

    if (this._isBottomsheet) {
      this._bsRecalcSnapPoints();
      this._bsApplyTransform(this._bs.y == null ? this._bs.peekY : this._bs.y, true);
      this._updateMapButtonVisibility();
    }

    return this;
  },

  removePanel: function (id) {
    var i, j, tab, pane, closeButtons;

    for (i = 0; i < this._tabitems.length; i++) {
      if (this._tabitems[i]._id === id) {
        tab = this._tabitems[i];
        this._tabClick(tab, "off");
        tab.remove();
        this._tabitems.splice(i, 1);
        break;
      }
    }

    for (i = 0; i < this._panes.length; i++) {
      if (this._panes[i].id === id) {
        pane = this._panes[i];
        closeButtons = pane.querySelectorAll(".leaflet-sidebar-close");
        for (j = 0; j < closeButtons.length; j++) this._closeClick(closeButtons[j], "off");
        pane.remove();
        this._panes.splice(i, 1);
        break;
      }
    }

    return this;
  },

  enablePanel: function (id) {
    var tab = this._getTab(id);
    L.DomUtil.removeClass(tab, "disabled");
    return this;
  },

  disablePanel: function (id) {
    var tab = this._getTab(id);
    L.DomUtil.addClass(tab, "disabled");
    return this;
  },

  onTabClick: function (e) {
    var sidebar = this._sidebar;
    var container = sidebar && sidebar._container;
    if (!sidebar || !container) return;
    if (sidebar._isBottomsheet) return;

    var isCollapsed = L.DomUtil.hasClass(container, "collapsed");

    var getActivePaneId = function () {
      if (!sidebar._panes) return null;
      for (var i = 0; i < sidebar._panes.length; i++) {
        var p = sidebar._panes[i];
        if (p && L.DomUtil.hasClass(p, "active")) return p.id;
      }
      return null;
    };

    var expandOnly = function () {
      if (L.DomUtil.hasClass(container, "collapsed")) {
        sidebar.fire("opening");
        L.DomUtil.removeClass(container, "collapsed");
        if (sidebar.options.autopan) sidebar._panMap("open");
      }
    };

    var desiredPaneFromHashOrLast = function () {
      var h = (window.location.hash || "").replace("#", "");
      if (h && (h === "home" || h.indexOf("pane-") === 0)) return h;
      if (h && h.indexOf("project-") === 0) return "pane-projectInfo";
      return sidebar._current || "home";
    };

    if (isCollapsed) {
      expandOnly();
      var active = getActivePaneId();
      if (active) return;
      sidebar.open(desiredPaneFromHashOrLast());
      return;
    }

    sidebar.close();
  },

  _tabClick: function (tab, on) {
    var link = tab.querySelector("a");
    if (!link || link.getAttribute("href")[0] !== "#") return;

    if (on === "on") {
      L.DomEvent.on(link, "click", L.DomEvent.preventDefault, tab).on(link, "click", this.onTabClick, tab);
    } else {
      L.DomEvent.off(link, "click", this.onTabClick, tab);
    }
  },

  onCloseClick: function () {
    this.close();
  },

  _closeClick: function (closeButton, on) {
    if (on === "on") {
      L.DomEvent.on(closeButton, "click", this.onCloseClick, this);
    } else {
      L.DomEvent.off(closeButton, "click", this.onCloseClick);
    }
  },

  _getTab: function (id) {
    for (var i = 0; i < this._tabitems.length; i++) if (this._tabitems[i]._id === id) return this._tabitems[i];
    throw Error('tab "' + id + '" not found');
  },

  _panMap: function (openClose) {
    var panWidth = Number.parseInt(L.DomUtil.getStyle(this._container, "max-width")) / 2;
    if (
      (openClose === "open" && this.options.position === "left") ||
      (openClose === "close" && this.options.position === "right")
    ) {
      panWidth *= -1;
    }
    this._map.panBy([panWidth, 0], { duration: 0.5 });
  },

  //Bottomsheet

  _ensureBottomsheetChrome: function (container) {
    if (!this._paneContainer) return;

    if (!this._paneContainer.querySelector(".leaflet-bottomsheet-handleRow")) {
      var handleRow = L.DomUtil.create("div", "leaflet-bottomsheet-handleRow", this._paneContainer);
      handleRow.innerHTML = '<div class="leaflet-bottomsheet-handle"></div>';
    }

    if (!container.querySelector(".leaflet-bottomsheet-mapBtn")) {
      var mapBtn = L.DomUtil.create("button", "leaflet-bottomsheet-mapBtn", container);
      mapBtn.type = "button";
      mapBtn.textContent = "Map";
      mapBtn.setAttribute("aria-label", "Show map");
    }
  },

  _applyResponsiveMode: function () {
    if (!this._container) return;

    var isBS = window.matchMedia("(max-width: " + this.options.bottomsheetMaxWidth + "px)").matches;

    if (isBS && !this._isBottomsheet) this._enableBottomsheet();
    else if (!isBS && this._isBottomsheet) this._disableBottomsheet();
  },

  _wireResizeListener: function () {
    if (this._resizeBound) return;
    this._resizeBound = this._onResize.bind(this);
    window.addEventListener("resize", this._resizeBound, { passive: true });
    window.addEventListener("orientationchange", this._resizeBound, { passive: true });
  },

  _onResize: function () {
    this._applyResponsiveMode();
    if (this._isBottomsheet) {
      this._bsRecalcSnapPoints();
      this._bsSnapTo(this._bs.state, true);
      this._updateMapButtonVisibility();
    }
  },

  _enableBottomsheet: function () {
    this._isBottomsheet = true;

    L.DomUtil.addClass(this._container, "leaflet-bottomsheet");
    L.DomUtil.removeClass(this._container, "collapsed");

    this._bsRecalcSnapPoints();

    this._bs.state = "peek";
    this._bs.y = this._bs.peekY;
    this._bsApplyTransform(this._bs.y, true);

    this._setupBottomsheetListeners();
    this._updateMapButtonVisibility();
  },

  _disableBottomsheet: function () {
    this._isBottomsheet = false;

    this._teardownBottomsheetListeners();

    L.DomUtil.removeClass(this._container, "leaflet-bottomsheet");
    this._container.style.transform = "";

    this._updateMapButtonVisibility();
  },

  _setupBottomsheetListeners: function () {
    var container = this._container;
    if (!container) return;

    var handleRow = this._paneContainer && this._paneContainer.querySelector(".leaflet-bottomsheet-handleRow");
    var mapBtn = container.querySelector(".leaflet-bottomsheet-mapBtn");

    if (handleRow && !this._bsPointerDownBound) {
      this._bsPointerDownBound = this._bsOnPointerDown.bind(this);
      handleRow.addEventListener("pointerdown", this._bsPointerDownBound, { passive: false });
    }

    if (mapBtn && !this._bsMapBtnBound) {
      this._bsMapBtnBound = (e) => {
        e.preventDefault();
        e.stopPropagation();
        this._bsSnapTo("peek", true);
        this._updateMapButtonVisibility();
      };
      mapBtn.addEventListener("click", this._bsMapBtnBound, { passive: false });
    }
  },

  _teardownBottomsheetListeners: function () {
    var container = this._container;
    if (!container) return;

    var handleRow = this._paneContainer && this._paneContainer.querySelector(".leaflet-bottomsheet-handleRow");
    var mapBtn = container.querySelector(".leaflet-bottomsheet-mapBtn");

    if (handleRow && this._bsPointerDownBound) {
      handleRow.removeEventListener("pointerdown", this._bsPointerDownBound);
      this._bsPointerDownBound = null;
    }
    if (mapBtn && this._bsMapBtnBound) {
      mapBtn.removeEventListener("click", this._bsMapBtnBound);
      this._bsMapBtnBound = null;
    }

    this._bsDetachDocListeners();
  },

  _bsRecalcSnapPoints: function () {
    var vh = Math.max(document.documentElement.clientHeight || 0, window.innerHeight || 0);

    var handleRow = this._paneContainer && this._paneContainer.querySelector(".leaflet-bottomsheet-handleRow");
    var handleH = (handleRow && handleRow.getBoundingClientRect && handleRow.getBoundingClientRect().height) || 34;

    var peekH = Math.max(28, Math.round(handleH));

    this._bs.peekY = Math.max(0, vh - peekH);
    this._bs.fullY = 0;

    this._bs.minY = this._bs.fullY;
    this._bs.maxY = this._bs.peekY;
  },

  _bsApplyTransform: function (y, immediate) {
    var container = this._container;
    if (!container) return;

    var clamped = Math.max(this._bs.minY, Math.min(this._bs.maxY, y));
    this._bs.y = clamped;

    if (immediate) {
      if (!this._bs.dragging) container.classList.remove("is-dragging");
    }

    container.style.transform = "translate3d(0," + clamped + "px,0)";
  },

  _bsSnapTo: function (state, immediate) {
    if (!this._isBottomsheet) return;

    var targetY = state === "full" ? this._bs.fullY : this._bs.peekY;

    this._bs.state = state;
    this._bsApplyTransform(targetY, true);
    this._updateMapButtonVisibility();
  },

  _updateMapButtonVisibility: function () {
    var btn = this._container && this._container.querySelector(".leaflet-bottomsheet-mapBtn");
    if (!btn) return;
    btn.style.display = this._isBottomsheet && this._bs.state === "full" ? "inline-flex" : "none";
  },

  _bsOnPointerDown: function (e) {
    if (!this._isBottomsheet) return;
    if (e.button != null && e.button !== 0) return;

    e.preventDefault();
    e.stopPropagation();

    this._bs.dragging = true;
    this._bs.startY = e.clientY;
    this._bs.startSheetY = this._bs.y != null ? this._bs.y : this._bs.peekY;

    this._bs.lastY = e.clientY;
    this._bs.lastT = performance.now();
    this._bs.vel = 0;

    this._container.classList.add("is-dragging");

    try {
      e.target.setPointerCapture(e.pointerId);
    } catch (_) {}

    this._bsAttachDocListeners(e.pointerId);
  },

  _bsAttachDocListeners: function () {
    if (this._bsMoveBound) return;

    this._bsMoveBound = (ev) => this._bsOnPointerMove(ev);
    this._bsUpBound = (ev) => this._bsOnPointerUp(ev);

    document.addEventListener("pointermove", this._bsMoveBound, { passive: false });
    document.addEventListener("pointerup", this._bsUpBound, { passive: false });
    document.addEventListener("pointercancel", this._bsUpBound, { passive: false });
  },

  _bsDetachDocListeners: function () {
    if (!this._bsMoveBound) return;

    document.removeEventListener("pointermove", this._bsMoveBound);
    document.removeEventListener("pointerup", this._bsUpBound);
    document.removeEventListener("pointercancel", this._bsUpBound);

    this._bsMoveBound = null;
    this._bsUpBound = null;
  },

  _bsOnPointerMove: function (e) {
    if (!this._isBottomsheet || !this._bs.dragging) return;

    e.preventDefault();

    var dy = e.clientY - this._bs.startY;
    var nextY = this._bs.startSheetY + dy;

    var now = performance.now();
    var dt = Math.max(1, now - this._bs.lastT);
    var dv = (e.clientY - this._bs.lastY) / dt;
    this._bs.vel = this._bs.vel * 0.7 + dv * 0.3;

    this._bs.lastY = e.clientY;
    this._bs.lastT = now;

    this._bsApplyTransform(nextY, false);
  },

  _bsOnPointerUp: function (e) {
    if (!this._isBottomsheet) return;

    if (this._bs.dragging) {
      e.preventDefault();
      e.stopPropagation();
    }

    this._bs.dragging = false;
    if (this._container) this._container.classList.remove("is-dragging");

    this._bsDetachDocListeners();

    var y = this._bs.y != null ? this._bs.y : this._bs.peekY;

    var v = this._bs.vel;
    var bias = 0;
    if (v < -0.6) bias = -120;
    else if (v < -0.25) bias = -60;
    else if (v > 0.6) bias = 120;
    else if (v > 0.25) bias = 60;

    var yBiased = y + bias;

    var dFull = Math.abs(yBiased - this._bs.fullY);
    var dPeek = Math.abs(yBiased - this._bs.peekY);

    this._bsSnapTo(dFull < dPeek ? "full" : "peek", true);
  }
});

L.control.sidebar = function (options, deprecated) {
  return new L.Control.Sidebar(options, deprecated);
};
