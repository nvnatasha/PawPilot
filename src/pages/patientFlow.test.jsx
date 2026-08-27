import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import App from '../App.jsx';

function renderApp(initialEntries = ['/']) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <App />
    </MemoryRouter>,
  );
}

describe('patient workflow', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('shows required-field validation on the new patient form', async () => {
    const user = userEvent.setup();
    renderApp(['/patients/new']);

    await user.click(screen.getByRole('button', { name: /save patient/i }));

    expect(screen.getByText('Patient name is required.')).toBeInTheDocument();
    expect(screen.getByText('Choose a species.')).toBeInTheDocument();
    expect(screen.getByText('Enter a weight greater than 0.')).toBeInTheDocument();
    expect(screen.getByText('Choose a workflow.')).toBeInTheDocument();
  });

  it('creates a patient, navigates to their dashboard, and displays persisted data', async () => {
    const user = userEvent.setup();
    renderApp(['/patients/new']);

    await user.type(screen.getByLabelText(/patient name/i), 'Milo');
    await user.selectOptions(screen.getByLabelText(/species/i), 'Canine');
    await user.type(screen.getByLabelText(/^weight$/i), '18.4');
    await user.selectOptions(screen.getByLabelText(/workflow/i), 'both');
    await user.type(screen.getByLabelText(/reason/i), 'Splenectomy');
    await user.click(screen.getByRole('button', { name: /save patient/i }));

    expect(await screen.findByRole('heading', { name: 'MILO' })).toBeInTheDocument();
    expect(screen.getByText(/Canine • 18.4 kg • 40.6 lb/i)).toBeInTheDocument();
    expect(screen.getByText('Splenectomy')).toBeInTheDocument();

    cleanup();
    renderApp(['/patients']);
    expect(screen.getByRole('heading', { name: 'Milo' })).toBeInTheDocument();
    expect(screen.getByText(/Anesthesia \+ Hospitalization/i)).toBeInTheDocument();
  });
});
