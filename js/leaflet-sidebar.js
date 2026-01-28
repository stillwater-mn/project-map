// leaflet-sidebar.js
// @ts-nocheck
/**
 * @name Sidebar
 * @class L.Control.Sidebar
 * @extends L.Control
 *
 * Full rewrite (same public API) with improvements:
 * - Supports panes WITHOUT tabs (skipTab panes): sidebar.open('pane-id') will not throw.
 * - Remembers last opened pane id (this._current).
 * - close() collapses WITHOUT clearing active tab/pane state.
 * - Hamburger tab click acts as a TRUE toggle:
 *    - If sidebar is open: collapse (keep active pane)
 *    - If sidebar is collapsed: expand WITHOUT calling open() (prevents rerender/"restart")
 *      If no active pane exists, open hash/last/home as fallback.
 *
 * Keeps existing functionality:
 * - addPanel/removePanel/enablePanel/disablePanel
 * - fires: 'content', 'opening', 'closing'
 * - autopan behavior
 * - close buttons in panes
 */
L.Control.Sidebar = L.Control.extend({
  includes: L.Evented ? L.Evented.prototype : L.Mixin.Events,

  options: {
    autopan: true,
    closeButton: true,
    container: null,
    position: 'left'
  },

  initialize: function (options, deprecatedOptions) {
    if (typeof options === 'string') {
      console.warn('Deprecated syntax. Use L.control.sidebar({ container })');
      options = { container: options };
    }
    if (typeof options === 'object' && options.id) {
      console.warn('Deprecated syntax. Use L.control.sidebar({ container })');
      options.container = options.id;
    }

    this._tabitems = [];
    this._panes = [];
    this._closeButtons = [];
    this._current = null;

    L.setOptions(this, options);
    L.setOptions(this, deprecatedOptions);
    return this;
  },

  onAdd: function (map) {
    var i, child, tabContainers, newContainer, container;

    container =
      this._container ||
      (typeof this.options.container === 'string'
        ? L.DomUtil.get(this.options.container)
        : this.options.container);

    if (!container) {
      container = L.DomUtil.create('div', 'leaflet-sidebar collapsed');
      if (typeof this.options.container === 'string') container.id = this.options.container;
    }

    // Content container
    this._paneContainer =
      container.querySelector('div.leaflet-sidebar-content') ||
      L.DomUtil.create('div', 'leaflet-sidebar-content', container);

    // Tabs containers (top/bottom)
    tabContainers = container.querySelectorAll('ul.leaflet-sidebar-tabs, div.leaflet-sidebar-tabs > ul');
    this._tabContainerTop = tabContainers[0] || null;
    this._tabContainerBottom = tabContainers[1] || null;

    if (!this._tabContainerTop) {
      newContainer = L.DomUtil.create('div', 'leaflet-sidebar-tabs', container);
      newContainer.setAttribute('role', 'tablist');
      this._tabContainerTop = L.DomUtil.create('ul', '', newContainer);
    }
    if (!this._tabContainerBottom) {
      newContainer = this._tabContainerTop.parentNode;
      this._tabContainerBottom = L.DomUtil.create('ul', '', newContainer);
    }

    // Store tabs from existing markup (if any)
    this._tabitems = [];
    for (i = 0; i < this._tabContainerTop.children.length; i++) {
      child = this._tabContainerTop.children[i];
      child._sidebar = this;

      var aTop = child.querySelector('a');
      if (!aTop || !aTop.hash) continue;

      child._id = aTop.hash.slice(1);
      this._tabitems.push(child);
    }
    for (i = 0; i < this._tabContainerBottom.children.length; i++) {
      child = this._tabContainerBottom.children[i];
      child._sidebar = this;

      var aBot = child.querySelector('a');
      if (!aBot || !aBot.hash) continue;

      child._id = aBot.hash.slice(1);
      this._tabitems.push(child);
    }

    // Store panes and wire close buttons
    this._panes = [];
    this._closeButtons = [];
    for (i = 0; i < this._paneContainer.children.length; i++) {
      child = this._paneContainer.children[i];
      if (child.tagName === 'DIV' && L.DomUtil.hasClass(child, 'leaflet-sidebar-pane')) {
        this._panes.push(child);

        var closeButtons = child.querySelectorAll('.leaflet-sidebar-close');
        if (closeButtons.length) {
          var btn = closeButtons[closeButtons.length - 1];
          this._closeButtons.push(btn);
          this._closeClick(btn, 'on');
        }
      }
    }

    // Wire tab click listeners
    for (i = 0; i < this._tabitems.length; i++) {
      this._tabClick(this._tabitems[i], 'on');
    }

    return container;
  },

  onRemove: function () {
    for (var i = 0; i < this._tabitems.length; i++) this._tabClick(this._tabitems[i], 'off');
    for (var j = 0; j < this._closeButtons.length; j++) this._closeClick(this._closeButtons[j], 'off');

    this._tabitems = [];
    this._panes = [];
    this._closeButtons = [];

    return this;
  },

  addTo: function (map) {
    this.onRemove();
    this._map = map;

    this._container = this.onAdd(map);

    L.DomUtil.addClass(this._container, 'leaflet-control');
    L.DomUtil.addClass(this._container, 'leaflet-sidebar-' + this.getPosition());
    if (L.Browser.touch) L.DomUtil.addClass(this._container, 'leaflet-touch');

    L.DomEvent.disableScrollPropagation(this._container);
    L.DomEvent.disableClickPropagation(this._container);
    L.DomEvent.on(this._container, 'contextmenu', L.DomEvent.stopPropagation);

    map._container.insertBefore(this._container, map._container.firstChild);

    return this;
  },

  removeFrom: function (map) {
    console.warn('removeFrom() is deprecated, use remove()');
    this._map._container.removeChild(this._container);
    this.onRemove(map);
    return this;
  },

  /**
   * Open a pane by id.
   * Works even when no corresponding tab exists (skipTab panes).
   */
  open: function (id) {
    var i, child;

    // Remember last opened pane
    this._current = id;

    // Optional tab lookup (skipTab panes have no tab)
    var tab = null;
    try {
      tab = this._getTab(id);
      if (tab && L.DomUtil.hasClass(tab, 'disabled')) return this;
    } catch (e) {
      tab = null;
    }

    // Activate panes
    for (i = 0; i < this._panes.length; i++) {
      child = this._panes[i];
      L.DomUtil[child.id === id ? 'addClass' : 'removeClass'](child, 'active');
    }

    // Activate tabs (only if present)
    for (i = 0; i < this._tabitems.length; i++) {
      child = this._tabitems[i];
      var link = child.querySelector('a');
      var isActive = link && link.hash === '#' + id;
      L.DomUtil[isActive ? 'addClass' : 'removeClass'](child, 'active');
    }

    // Notify content change
    this.fire('content', { id: id });

    // Expand if collapsed
    if (L.DomUtil.hasClass(this._container, 'collapsed')) {
      this.fire('opening');
      L.DomUtil.removeClass(this._container, 'collapsed');
      if (this.options.autopan) this._panMap('open');
    }

    return this;
  },

  /**
   * Collapse sidebar WITHOUT clearing active tab/pane state.
   */
  close: function () {
    if (!L.DomUtil.hasClass(this._container, 'collapsed')) {
      this.fire('closing');
      L.DomUtil.addClass(this._container, 'collapsed');
      if (this.options.autopan) this._panMap('close');
    }
    return this;
  },

  /**
   * Add a panel. Supports `skipTab` to create a pane without a tab.
   */
  addPanel: function (data) {
    var pane, tab, tabHref, closeButtons, content;

    if (!data.skipTab) {
      tab = L.DomUtil.create('li', data.disabled ? 'disabled' : '');
      tabHref = L.DomUtil.create('a', '', tab);
      tabHref.href = '#' + data.id;
      tabHref.setAttribute('role', 'tab');
      tabHref.innerHTML = data.tab || '';
      tab._sidebar = this;
      tab._id = data.id;
      tab._button = data.button;
      if (data.title && data.title[0] !== '<') tab.title = data.title;

      if (data.position === 'bottom') this._tabContainerBottom.appendChild(tab);
      else this._tabContainerTop.appendChild(tab);

      this._tabitems.push(tab);
      this._tabClick(tab, 'on');
    }

    if (data.pane) {
      if (typeof data.pane === 'string') {
        pane = L.DomUtil.create('div', 'leaflet-sidebar-pane', this._paneContainer);
        content = '';
        if (data.title) content += '<h1 class="leaflet-sidebar-header">' + data.title;
        if (this.options.closeButton)
          content +=
            '<span class="leaflet-sidebar-close"><i class="fa fa-caret-' +
            this.options.position +
            '"></i></span>';
        if (data.title) content += '</h1>';
        pane.innerHTML = content + data.pane;
      } else {
        pane = data.pane;
        this._paneContainer.appendChild(pane);
      }
      pane.id = data.id;

      this._panes.push(pane);

      closeButtons = pane.querySelectorAll('.leaflet-sidebar-close');
      if (closeButtons.length) {
        var btn = closeButtons[closeButtons.length - 1];
        this._closeButtons.push(btn);
        this._closeClick(btn, 'on');
      }
    }

    return this;
  },

  removePanel: function (id) {
    var i, j, tab, pane, closeButtons;

    for (i = 0; i < this._tabitems.length; i++) {
      if (this._tabitems[i]._id === id) {
        tab = this._tabitems[i];
        this._tabClick(tab, 'off');
        tab.remove();
        this._tabitems.splice(i, 1);
        break;
      }
    }

    for (i = 0; i < this._panes.length; i++) {
      if (this._panes[i].id === id) {
        pane = this._panes[i];
        closeButtons = pane.querySelectorAll('.leaflet-sidebar-close');
        for (j = 0; j < closeButtons.length; j++) this._closeClick(closeButtons[j], 'off');

        pane.remove();
        this._panes.splice(i, 1);
        break;
      }
    }

    return this;
  },

  enablePanel: function (id) {
    var tab = this._getTab(id);
    L.DomUtil.removeClass(tab, 'disabled');
    return this;
  },

  disablePanel: function (id) {
    var tab = this._getTab(id);
    L.DomUtil.addClass(tab, 'disabled');
    return this;
  },

  /**
   * Tab click behavior (hamburger toggle):
   * - If collapsed: EXPAND ONLY (do NOT call open() -> avoids rerender/restart)
   *   If no pane is active, open hash/last/home as fallback.
   * - If open: collapse (close) and keep active pane.
   *
   * Note: This no longer depends on the tab <li> having the 'active' class.
   */
  onTabClick: function (e) {
    var sidebar = this._sidebar;
    var container = sidebar && sidebar._container;
    if (!sidebar || !container) return;

    var isCollapsed = L.DomUtil.hasClass(container, 'collapsed');

    var getActivePaneId = function () {
      if (!sidebar._panes) return null;
      for (var i = 0; i < sidebar._panes.length; i++) {
        var p = sidebar._panes[i];
        if (p && L.DomUtil.hasClass(p, 'active')) return p.id;
      }
      return null;
    };

    var expandOnly = function () {
      if (L.DomUtil.hasClass(container, 'collapsed')) {
        sidebar.fire('opening');
        L.DomUtil.removeClass(container, 'collapsed');
        if (sidebar.options.autopan) sidebar._panMap('open');
      }
    };

    var desiredPaneFromHashOrLast = function () {
      var h = (window.location.hash || '').replace('#', '');

      if (h && (h === 'home' || h.indexOf('pane-') === 0)) return h;
      if (h && h.indexOf('project-') === 0) return 'pane-projectInfo';

      return sidebar._current || 'home';
    };

    if (isCollapsed) {
      // Expand without restarting content
      expandOnly();

      // If a pane is already active, stop here (preserve DOM exactly)
      var active = getActivePaneId();
      if (active) return;

      // No active pane? Open something sensible (fires content)
      sidebar.open(desiredPaneFromHashOrLast());
      return;
    }

    // Open -> collapse (keep active state)
    sidebar.close();
  },

  _tabClick: function (tab, on) {
    var link = tab.querySelector('a');
    if (!link || link.getAttribute('href')[0] !== '#') return;

    if (on === 'on') {
      L.DomEvent.on(link, 'click', L.DomEvent.preventDefault, tab).on(link, 'click', this.onTabClick, tab);
    } else {
      L.DomEvent.off(link, 'click', this.onTabClick, tab);
    }
  },

  onCloseClick: function () {
    this.close();
  },

  _closeClick: function (closeButton, on) {
    if (on === 'on') {
      L.DomEvent.on(closeButton, 'click', this.onCloseClick, this);
    } else {
      L.DomEvent.off(closeButton, 'click', this.onCloseClick);
    }
  },

  _getTab: function (id) {
    for (var i = 0; i < this._tabitems.length; i++) if (this._tabitems[i]._id === id) return this._tabitems[i];
    throw Error('tab "' + id + '" not found');
  },

  _panMap: function (openClose) {
    var panWidth = Number.parseInt(L.DomUtil.getStyle(this._container, 'max-width')) / 2;
    if (
      (openClose === 'open' && this.options.position === 'left') ||
      (openClose === 'close' && this.options.position === 'right')
    ) {
      panWidth *= -1;
    }
    this._map.panBy([panWidth, 0], { duration: 0.5 });
  }
});

L.control.sidebar = function (options, deprecated) {
  return new L.Control.Sidebar(options, deprecated);
};
