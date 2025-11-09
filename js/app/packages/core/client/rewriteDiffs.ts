// import { isErr } from '@core/util/maybeResult';
// import { cognitionApiServiceClient } from '@service-cognition/client';

// type StructuredOutputSchema = {
//   type: string;
//   properties: Record<string, any>;
//   required: string[];
//   additionalProperties: boolean;
// };

// export const DiffsSchema: StructuredOutputSchema = {
//   type: 'object',
//   properties: {
//     diffs: {
//       type: 'array',
//       items: {
//         type: 'object',
//         properties: {
//           operation: {
//             type: 'string',
//             description: 'The type of operation performed in this diff',
//             enum: ['INSERT_AFTER', 'INSERT_BEFORE', 'DELETE', 'MODIFY'],
//           },
//           node_key: {
//             type: 'string',
//             description: 'Identifier for the node affected by this diff',
//           },
//           markdown_text: {
//             type: 'string',
//             description:
//               'The text content associated with this diff. Leave empty for DELETE operations.',
//           },
//         },
//         required: ['operation', 'node_id'],
//         additionalProperties: false,
//       },
//     },
//   },
//   required: ['diffs'],
//   additionalProperties: false,
// };

// export async function rewriteDiffs<T>(prompt: string): Promise<T | undefined> {
//   const schema_name = 'diffs_schema';

//   let response = await cognitionApiServiceClient.getAIDiffs({
//     prompt,
//     schema: DiffsSchema,
//     schema_name,
//   });

//   if (isErr(response)) {
//     console.error('Error in rewrite diffs');
//     return;
//   }

//   const diffs = response.at(1)?.diffs;
//   if (!diffs) {
//     console.error('No content in rewrite diffs');
//     return undefined;
//   }

//   return diffs as T;
// }
