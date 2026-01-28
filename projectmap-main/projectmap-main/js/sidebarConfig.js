// js/sidebarConfig.js
import { buildWhereForProjectType } from './services/projectsService.js';
import { PROJECT_INFO_FIELDS } from './config.js';

export const sidebarConfig = [
  {
    id: 'home',
    kind: 'home',
    title: 'Project Viewer',
    tabIcon: 'fa-bars',
    skipTab: false,
    content: `
      <div class="image-link-grid">
        <div class="ui-block-a welcome-pane-all">
          <a href="#pane-all" class="sidebar-pane-link">
            <div class="ui-bar">All Projects</div>
          </a>
        </div>
        <div class="ui-block-b welcome-pane-engineering">
          <a href="#pane-engineering" class="sidebar-pane-link">
            <div class="ui-bar">Engineering & Public Works</div>
          </a>
        </div>
        <div class="ui-block-a welcome-pane-parks">
          <a href="#pane-parks" class="sidebar-pane-link">
            <div class="ui-bar">Parks & Trails</div>
          </a>
        </div>
        <div class="ui-block-b welcome-pane-planning">
          <a href="#pane-planning" class="sidebar-pane-link">
            <div class="ui-bar">Planning & Development</div>
          </a>
        </div>
      </div>
    `
  },

  // Generic “list panes”
  {
    id: 'pane-all',
    kind: 'list',
    title: 'All Projects',
    skipTab: true,
    where: '1=1',
    list: {
      tableId: 'table-all',
      // cache bucket selector
      projectType: null,
      // columns define the list view (you can add more columns later)
      columns: [{ key: 'project_name', label: 'Project Name' }],
      // clicking a row navigates to a route
      rowRoute: (props) => `project-${props.OBJECTID}`
    }
  },

  {
    id: 'pane-engineering',
    kind: 'list',
    title: 'Engineering & Public Works',
    skipTab: true,
    where: buildWhereForProjectType('Streets & Utilities'),
    list: {
      tableId: 'table-engineering',
      projectType: 'Streets & Utilities',
      columns: [{ key: 'project_name', label: 'Project Name' }],
      rowRoute: (props) => `project-${props.OBJECTID}`
    }
  },

  {
    id: 'pane-parks',
    kind: 'list',
    title: 'Parks & Trails',
    skipTab: true,
    where: buildWhereForProjectType('Parks & Trails'),
    list: {
      tableId: 'table-parks',
      projectType: 'Parks & Trails',
      columns: [{ key: 'project_name', label: 'Project Name' }],
      rowRoute: (props) => `project-${props.OBJECTID}`
    }
  },

  {
    id: 'pane-planning',
    kind: 'list',
    title: 'Planning & Development',
    skipTab: true,
    where: buildWhereForProjectType('Planning & Development'),
    list: {
      tableId: 'table-planning',
      projectType: 'Planning & Development',
      columns: [{ key: 'project_name', label: 'Project Name' }],
      rowRoute: (props) => `project-${props.OBJECTID}`
    }
  },

  // Generic “detail pane”
  {
    id: 'pane-projectInfo',
    kind: 'detail',
    title: 'Project Information',
    skipTab: true,
    detail: {
      tableId: 'table-projectInfo',
      fields: PROJECT_INFO_FIELDS,
      attachments: { hostId: 'project-attachments' }
    }
  }
];
