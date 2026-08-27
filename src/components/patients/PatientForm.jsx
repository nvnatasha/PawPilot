import { useMemo, useState } from 'react';
import { normalizeWeight, formatWeight } from '../../utils/weight.js';
import { validatePatient } from '../../utils/patientValidation.js';

const defaultValues = {
  name: '',
  species: '',
  weight: '',
  weightUnit: 'kg',
  workflow: '',
  age: '',
  sexStatus: '',
  reason: '',
};

export default function PatientForm({ initialValues, onSubmit, submitLabel = 'Save Patient' }) {
  const [values, setValues] = useState({ ...defaultValues, ...initialValues });
  const [errors, setErrors] = useState({});

  const convertedWeight = useMemo(
    () => normalizeWeight(values.weight, values.weightUnit),
    [values.weight, values.weightUnit],
  );

  function updateField(event) {
    const { name, value } = event.target;
    setValues((current) => ({ ...current, [name]: value }));
    setErrors((current) => ({ ...current, [name]: undefined }));
  }

  function handleSubmit(event) {
    event.preventDefault();
    const nextErrors = validatePatient(values);
    setErrors(nextErrors);

    if (Object.keys(nextErrors).length > 0) {
      return;
    }

    onSubmit({
      name: values.name.trim(),
      species: values.species,
      weightKg: convertedWeight.weightKg,
      weightLb: convertedWeight.weightLb,
      age: values.age.trim(),
      sexStatus: values.sexStatus.trim(),
      reason: values.reason.trim(),
      workflow: values.workflow,
    });
  }

  return (
    <form className="patient-form" onSubmit={handleSubmit} noValidate>
      <div className="form-grid">
        <label>
          <span>Patient name</span>
          <input
            aria-describedby={errors.name ? 'name-error' : undefined}
            aria-invalid={Boolean(errors.name)}
            name="name"
            onChange={updateField}
            value={values.name}
          />
          {errors.name && <small id="name-error">{errors.name}</small>}
        </label>

        <label>
          <span>Species</span>
          <select
            aria-describedby={errors.species ? 'species-error' : undefined}
            aria-invalid={Boolean(errors.species)}
            name="species"
            onChange={updateField}
            value={values.species}
          >
            <option value="">Choose species</option>
            <option value="Canine">Canine</option>
            <option value="Feline">Feline</option>
          </select>
          {errors.species && <small id="species-error">{errors.species}</small>}
        </label>

        <label>
          <span>Weight</span>
          <input
            aria-describedby={errors.weight ? 'weight-error' : undefined}
            aria-invalid={Boolean(errors.weight)}
            inputMode="decimal"
            min="0"
            name="weight"
            onChange={updateField}
            type="number"
            value={values.weight}
          />
          {errors.weight && <small id="weight-error">{errors.weight}</small>}
        </label>

        <label>
          <span>Weight unit</span>
          <select name="weightUnit" onChange={updateField} value={values.weightUnit}>
            <option value="kg">kg</option>
            <option value="lb">lb</option>
          </select>
        </label>

        <label>
          <span>Workflow</span>
          <select
            aria-describedby={errors.workflow ? 'workflow-error' : undefined}
            aria-invalid={Boolean(errors.workflow)}
            name="workflow"
            onChange={updateField}
            value={values.workflow}
          >
            <option value="">Choose workflow</option>
            <option value="anesthesia">Anesthesia / Surgery</option>
            <option value="hospitalization">Hospitalization</option>
            <option value="both">Both</option>
          </select>
          {errors.workflow && <small id="workflow-error">{errors.workflow}</small>}
        </label>

        <label>
          <span>Age</span>
          <input name="age" onChange={updateField} value={values.age} />
        </label>

        <label>
          <span>Sex / reproductive status</span>
          <input name="sexStatus" onChange={updateField} value={values.sexStatus} />
        </label>

        <label className="full-span">
          <span>Reason for visit / procedure</span>
          <textarea name="reason" onChange={updateField} rows="4" value={values.reason} />
        </label>
      </div>

      {convertedWeight.weightKg && convertedWeight.weightLb ? (
        <div className="conversion-panel" aria-live="polite">
          <span>Calculated weight</span>
          <strong>
            {formatWeight(convertedWeight.weightKg)} kg • {formatWeight(convertedWeight.weightLb)} lb
          </strong>
        </div>
      ) : null}

      <div className="form-actions">
        <button className="primary-button" type="submit">
          {submitLabel}
        </button>
      </div>
    </form>
  );
}
