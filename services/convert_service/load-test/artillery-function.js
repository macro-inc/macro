/**
 * Custom functions for Artillery load testing
 */

const file_names = [
  'Apple10k.docx',
  'Table.docx',
  'feature_packed.docx',
  'feature_packed2.docx',
];

// Generate random data for the context
function generateRandomData(context, events, done) {
  const file_name = file_names[Math.floor(Math.random() * file_names.length)];
  context.vars.file_name = `convert-loadtest-input/${file_name}`;
  const random_value = Math.random().toString(36).substring(2, 15);
  context.vars.output_file_name = `convert-loadtest-output/${random_value}-${file_name.replace('.docx', '.pdf')}`;

  return done();
}

module.exports = {
  generateRandomData,
};
