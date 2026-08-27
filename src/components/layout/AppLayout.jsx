import { NavLink, Outlet, useNavigate } from 'react-router-dom';

const primaryActions = [
  { label: 'Anesthesia', to: '/anesthesia' },
  { label: 'Hospitalization', to: '/hospitalization' },
  { label: 'Dosage Calculator', to: '/calculators' },
];

export default function AppLayout() {
  const navigate = useNavigate();

  return (
    <div className="app-shell">
      <aside className="sidebar" aria-label="Primary navigation">
        <div className="brand">
          <span className="brand-mark">P</span>
          <span>PawPilot</span>
        </div>

        <nav className="sidebar-nav">
          <NavLink to="/" end>
            Dashboard
          </NavLink>
          <NavLink to="/patients">Patients</NavLink>
          <NavLink to="/reference" className="disabled-link" aria-disabled="true">
            Reference <span>Later</span>
          </NavLink>
          <NavLink to="/settings" className="disabled-link" aria-disabled="true">
            Settings <span>Later</span>
          </NavLink>
        </nav>
      </aside>

      <div className="content-shell">
        <header className="topbar">
          <div>
            <p className="eyebrow">Veterinary technician care companion</p>
            <h1>Current Patients</h1>
          </div>
          <div className="topbar-actions" aria-label="Primary actions">
            {primaryActions.map((action) => (
              <button
                className="ghost-button"
                key={action.label}
                onClick={() => navigate(action.to)}
                type="button"
              >
                {action.label}
              </button>
            ))}
            <button className="primary-button" onClick={() => navigate('/patients/new')} type="button">
              New Patient
            </button>
          </div>
        </header>

        <main className="main-content">
          <Outlet />
        </main>

        <footer className="app-footer">
          PawPilot is a workflow and calculation aid. Verify calculations, drug doses, and treatment
          plans according to your hospital protocols and supervising veterinarian.
        </footer>
      </div>
    </div>
  );
}
