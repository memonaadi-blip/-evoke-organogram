/* =====================================================================
   Evoke Organogram — configuration
   Edit this file to change branding, the drill hierarchy, and behaviour.
   You can also change the hierarchy live in the app (Settings) and export
   a fresh copy of this file to commit back.
   ===================================================================== */
window.ORG_CONFIG = {
  /* --- branding --- */
  orgName:  "Evoke",
  subtitle: "Organisation hierarchy",
  accent:   "#c1872c",          // signature colour

  /* --- the drill path, top → bottom ---
     Each level groups people by a field. The individual employee is always
     the final leaf. Reorder, add, or remove levels here (or in Settings).
     Available fields: department, section, business_area, company, position */
  hierarchy: ["department", "section"],

  /* --- field definitions: key = data field, label = what users see --- */
  fields: [
    { key: "emp_no",        label: "Emp No.",       group: false },
    { key: "name",          label: "Employee Name", group: false },
    { key: "position",      label: "Position",      group: true  },
    { key: "department",    label: "Department",    group: true  },
    { key: "section",       label: "Section",       group: true  },
    { key: "business_area", label: "Business Area", group: true  },
    { key: "company",       label: "Company",       group: true  }
  ],

  /* chips shown on each employee card */
  cardChips: ["business_area", "company"],

  /* --- editing ---
     allowEditing : master switch for the edit toolset
     editByDefault: if false, the plain link is READ-ONLY (good for management);
                    append ?edit=1 to the URL to unlock editing. */
  allowEditing:  true,
  editByDefault: false
};
