import { normalizeWeight } from './weight.js';

export function validatePatient(values) {
  const errors = {};

  if (!values.name.trim()) {
    errors.name = 'Patient name is required.';
  }

  if (!values.species) {
    errors.species = 'Choose a species.';
  }

  const normalizedWeight = normalizeWeight(values.weight, values.weightUnit);
  if (!normalizedWeight.weightKg || !normalizedWeight.weightLb) {
    errors.weight = 'Enter a weight greater than 0.';
  }

  if (!values.workflow) {
    errors.workflow = 'Choose a workflow.';
  }

  return errors;
}
