"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BaseResponse = void 0;
const zod_1 = require("zod");
// The base response for all jobs
// All response objects will extend this and any custom data in a response object
// will be located in it's `data` property
exports.BaseResponse = zod_1.z.object({
    // The id of the job
    jobId: zod_1.z.string(),
    // The type of the job (JobTypes)
    jobType: zod_1.z.string(),
    // If there was an error
    error: zod_1.z.boolean().optional(),
    // The error message if error is true
    message: zod_1.z.string().optional(),
});
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYmFzZVJlc3BvbnNlLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vc3JjL2pvYlR5cGVzL2Jhc2VSZXNwb25zZS50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFBQSw2QkFBd0I7QUFFeEIsaUNBQWlDO0FBQ2pDLGlGQUFpRjtBQUNqRiwwQ0FBMEM7QUFDN0IsUUFBQSxZQUFZLEdBQUcsT0FBQyxDQUFDLE1BQU0sQ0FBQztJQUNuQyxvQkFBb0I7SUFDcEIsS0FBSyxFQUFFLE9BQUMsQ0FBQyxNQUFNLEVBQUU7SUFDakIsaUNBQWlDO0lBQ2pDLE9BQU8sRUFBRSxPQUFDLENBQUMsTUFBTSxFQUFFO0lBQ25CLHdCQUF3QjtJQUN4QixLQUFLLEVBQUUsT0FBQyxDQUFDLE9BQU8sRUFBRSxDQUFDLFFBQVEsRUFBRTtJQUM3QixxQ0FBcUM7SUFDckMsT0FBTyxFQUFFLE9BQUMsQ0FBQyxNQUFNLEVBQUUsQ0FBQyxRQUFRLEVBQUU7Q0FDL0IsQ0FBQyxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgeiB9IGZyb20gJ3pvZCc7XG5cbi8vIFRoZSBiYXNlIHJlc3BvbnNlIGZvciBhbGwgam9ic1xuLy8gQWxsIHJlc3BvbnNlIG9iamVjdHMgd2lsbCBleHRlbmQgdGhpcyBhbmQgYW55IGN1c3RvbSBkYXRhIGluIGEgcmVzcG9uc2Ugb2JqZWN0XG4vLyB3aWxsIGJlIGxvY2F0ZWQgaW4gaXQncyBgZGF0YWAgcHJvcGVydHlcbmV4cG9ydCBjb25zdCBCYXNlUmVzcG9uc2UgPSB6Lm9iamVjdCh7XG4gIC8vIFRoZSBpZCBvZiB0aGUgam9iXG4gIGpvYklkOiB6LnN0cmluZygpLFxuICAvLyBUaGUgdHlwZSBvZiB0aGUgam9iIChKb2JUeXBlcylcbiAgam9iVHlwZTogei5zdHJpbmcoKSxcbiAgLy8gSWYgdGhlcmUgd2FzIGFuIGVycm9yXG4gIGVycm9yOiB6LmJvb2xlYW4oKS5vcHRpb25hbCgpLFxuICAvLyBUaGUgZXJyb3IgbWVzc2FnZSBpZiBlcnJvciBpcyB0cnVlXG4gIG1lc3NhZ2U6IHouc3RyaW5nKCkub3B0aW9uYWwoKSxcbn0pO1xuIl19