# PawPilot

PawPilot is a technician-focused veterinary workflow application designed to make anesthesia monitoring and hospitalized-patient documentation easier to organize, record, and export.

> **Status:** Active development. Core patient, anesthesia, hospitalization, settings, and record-export workflows are implemented, but the application is not yet production-ready and should not be used as a substitute for hospital protocols or clinical judgment.

## Why I Built It

As a Registered Veterinary Technician working in emergency medicine, I wanted to build software around the workflows veterinary technicians actually use: setting up anesthesia, recording live monitoring values, documenting medications and fluids, managing hospitalized-patient treatments, and producing a clean record that can be added to the patient chart.

PawPilot combines my veterinary background with my full-stack software engineering training and gives me a place to solve real workflow problems through code.

## Current Features

- Patient creation, editing, validation, weight conversion, and persistent local storage
- Technician-focused patient dashboard
- Anesthesia setup with procedure, staff, circuit, oxygen, reservoir bag, fluids, drugs, and notes
- Anesthetic drug calculations using user-supplied medication values
- Live anesthesia monitoring at configurable intervals
- Scheduled monitoring points plus unscheduled/extra entries
- Medication, fluid, event, and recovery documentation
- Hospitalization treatment sheets with 24-hour scheduling
- TPR and custom monitoring documentation
- Medication scheduling, rescheduling, skip/hold, and PRN documentation workflows
- Fluid plans, interval checks, rate changes, boluses, bag tracking, pauses/restarts, and discontinuation
- Chronological treatment/event timelines
- Clinic preferences and configurable defaults
- Print-friendly clinical records
- CSV and JSON record export
- Automated tests covering calculations, monitoring, scheduling, services, patient flow, settings, and print records

## Tech Stack

- **Frontend:** React, JavaScript, Vite
- **Routing:** React Router
- **Testing:** Vitest, React Testing Library
- **Persistence:** Browser localStorage with normalized/versioned application data
- **Styling:** CSS
- **Workflow:** Git/GitHub, test-driven and iterative development

## Engineering Focus

PawPilot has been especially useful for practicing:

- Breaking complex real-world workflows into reusable components and services
- State persistence and schema normalization/versioning
- Scheduling and time-based workflow logic
- Validation and calculation utilities
- Regression testing during rapid feature development
- Root-cause debugging across UI, persistence, scheduling, and print behavior
- Designing print/export output separately from an interactive application UI
- Translating veterinary-domain requirements into software behavior

## Run Locally

```bash
npm install
npm run dev
```

Then open the local Vite URL shown in the terminal.

## Testing

```bash
npm test
```

## Production Build

```bash
npm run build
```

## Roadmap

PawPilot is still evolving. Planned work includes continued UX refinement, broader record/export workflows, additional clinic-level preferences, stronger data portability, and evaluating an appropriate backend/persistence model for future versions.

## Disclaimer

PawPilot is a personal software project in active development. Medication values, calculations, monitoring settings, and treatment documentation must be verified by qualified veterinary personnel and used according to the individual hospital's protocols.

---

Built by **Natasha Vasquez, RVT** — veterinary technician + full-stack software engineer.
