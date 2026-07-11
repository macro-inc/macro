An SDK for the anthropic api

This mostly follows the patterns established by https://github.com/64bit/async-openai.

This implementation is incomplete and only implements the functionality that is already used
_for chat_ in the ai crate.

The `openai` feature adds a dependency on the `async-openai` crate and defines mappings
from and to openai request and response types respectively. The idea is to use the `v1/chat/completions` api
as the standard. Most open source models adhere to this standard and this is the api used by openrouter.
