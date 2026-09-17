import { match } from 'ts-pattern';
import { createSpreadsheetCalculator } from '../core/calculation';
import type {
  CalculationRequest,
  CalculationResponse,
} from '../core/calculation-protocol';

const calculator = createSpreadsheetCalculator();
self.onmessage = async (event: MessageEvent<CalculationRequest>) => {
  const request = event.data;
  let response: CalculationResponse;
  try {
    const engine = await calculator;
    self.postMessage({
      id: request.id,
      type: 'started',
    } satisfies CalculationResponse);
    response = match(request)
      .returnType<CalculationResponse>()
      .with({ type: 'calculate' }, (operation) => ({
        id: operation.id,
        type: 'calculate',
        values: engine.calculate(operation.cells, operation.rowCount),
      }))
      .with({ type: 'calculate-workbook' }, (operation) => ({
        id: operation.id,
        type: 'calculate-workbook',
        values: engine.calculateWorkbook(operation.sheets),
      }))
      .with({ type: 'copy' }, (operation) => ({
        id: operation.id,
        type: 'copy',
        edits: engine.copy(operation.copies, operation.context),
      }))
      .with({ type: 'complete' }, (operation) => ({
        id: operation.id,
        type: 'complete',
        context: engine.complete(
          operation.text,
          operation.cursor,
          operation.context
        ),
      }))
      .exhaustive();
  } catch (error) {
    response = {
      id: request.id,
      type: 'error',
      message: error instanceof Error ? error.message : 'Calculation failed.',
    };
  }
  self.postMessage(response);
};
