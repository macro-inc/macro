import { DopplerProject } from './doppler_project';

const SERVICE_NAMES = [
  'authentication-service',
  'convert-service',
  'notification-service',
  'contacts-service',
  'cloud-storage-service',
  'search-processing-service',
  'unfurl-service',
  'static-file-service',
];

for (const service_name of SERVICE_NAMES) {
  new DopplerProject(service_name, {});
}
