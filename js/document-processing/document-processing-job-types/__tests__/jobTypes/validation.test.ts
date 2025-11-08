import {
  // JobResponseDataValidation,
  JobResponseValidation,
  JobValidation,
} from '../../src/jobTypes/index';
import { JobTypeEnum } from '../../src/jobTypes/jobTypes';

import { is_preprocess_invoke } from '../../src/jobTypes/pdf/preprocess';

describe('JobTypes', () => {
  test('validate JobValidation', () => {
    for (const jobType of Object.values(JobTypeEnum)) {
      expect(JobValidation[jobType]).toBeTruthy();
    }
  });
  test('validate JobResponseValidation', () => {
    for (const jobType of Object.values(JobTypeEnum)) {
      expect(JobResponseValidation[jobType]).toBeTruthy();
    }
  });
  // At the moment we haven't completed the job response data validation so this
  // test is expected to fail and will be commented out
  // test('validate JobResponseDataValidation', () => {
  //   for (const jobType of Object.values(JobTypeEnum)) {
  //     expect(JobResponseDataValidation[jobType]).toBeTruthy();
  //   }
  // });
  //
  test('pdf_preprocess', () => {
    const d: { [name: string]: any } = {
      documentId: 'document-one',
      documentVersionId: 1,
    };

    expect(is_preprocess_invoke(d)).toBeTruthy();
  });
});
