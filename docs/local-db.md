# Local database protocol — iteration 1

`@gamma-compose/local-db` runs in the browser. JSON models describe records; applications compose asynchronous CRUD functions and own all relationships and business rules. No HTTP protocol is involved.

The public package entry exports `openLocalDb`, `LocalDbError`, and the JSON, record, resource, query, page, error, and database types. It exports no React bindings or implementation helpers. See the [package README](../ui-packages/local-db/README.md) for a complete resource and usage example.

## Model contract

```ts
type ResourceDefinition = {
  protocolVersion: number // Must be 1 at runtime.
  name: string
  schema: Record<string, unknown>
  indexes?: readonly (readonly string[])[]
}
```

The wrapper and `indexes` are Gamma conventions, not standard JSON Schema keywords. `schema` uses [JSON Schema 2020-12](https://json-schema.org/draft/2020-12). Resource names match `^[a-z][a-z0-9-]*$` and are unique within an instance. Fields cannot start with `$`. Unsupported wrapper properties, protocol versions, or schema keywords fail with `INVALID_MODEL` before storage opens.

The root schema has `type: "object"`, `additionalProperties: false`, an explicitly declared `id` of type string, and `id` in `required`. It describes the complete stored record, not the create input. Each nested schema declares a type. Allowed types are string, number, integer, boolean, object, array, and null; a two-element type array may combine one non-null type with null.

| Keyword group | Supported keywords |
| --- | --- |
| Dialect and annotations | `$schema` (2020-12 only, optional), `title`, `description` |
| Structure | `type`, `properties`, `required`, `additionalProperties`, `items` |
| Values | `enum` |
| Strings | `minLength`, `maxLength` |
| Numbers | `minimum`, `maximum`, `exclusiveMinimum`, `exclusiveMaximum` |
| Arrays | `minItems`, `maxItems` |

Nested objects and arrays are stored inside a record, not as relationships. Nested `additionalProperties` follows JSON Schema semantics: omitted means allowed, false rejects undeclared properties, and a schema validates extra values. Objects in `properties` and `items` follow the same supported subset. Strict Ajv schema checks also reject keywords used with inappropriate types or `required` names missing from `properties`.

`$ref`, formats, regular expressions, conditional/composition schemas, custom keywords, and `default` are not supported. Ajv runs with strict validation, own-property checks and complete error reporting, without coercion, default insertion or property removal. Models and values must be finite, acyclic JSON data; JavaScript-specific values, sparse arrays, accessors and symbol properties are rejected rather than sanitized.

Indexes are optional arrays of distinct top-level field names, such as `[["status"], ["projectId", "title"]]`. Indexed field names must be identifier names accepted by IndexedDB key paths, not dotted paths or punctuation-separated names. Fields must be strings or numbers (including integer), optionally nullable. Indexes are non-unique and do not imply foreign keys or business uniqueness. Null and absent values do not produce IndexedDB index keys. Boolean, object, array, and nested-path indexes are unsupported. UUID `id` is always the primary key.

## Public operations

```ts
const db = await openLocalDb({ databaseName, resources })
```

`databaseName` is a nonempty string. Definitions are captured at initialization; mutating the supplied objects does not reconfigure an open instance. The library compiles validators once per initialization, then opens storage. Failed initialization rejects instead of returning a partially usable instance.

| Operation | Result | Missing-record behavior |
| --- | --- | --- |
| `create(resource, data)` | Full record, including generated `id` | Not applicable |
| `get(resource, id)` | Record or `undefined` | `undefined` |
| `list(resource, query?)` | `{ data, total, limit, offset }` | Empty page |
| `update(resource, id, changes)` | Full updated record | `NOT_FOUND` |
| `remove(resource, id)` | `void` | Success |
| `close()` | Synchronous `void` | Repeat calls are safe |

All data operations return Promises. IDs passed to methods must be nonempty strings. `create` generates an ID with `crypto.randomUUID()`; both `create` and `update` reject a caller-supplied `id` property and unknown fields in the submitted input. An update retains only the existing record's top-level fields declared in the current model, shallowly merges the submitted changes, validates the full result, and saves it. Objects and arrays replace the previous field value in full; there is no recursive cleanup, deep merge, field-unset operator, upsert, bulk operation or nested write.

Writes report success only when the IndexedDB transaction commits. One update reads and writes in a single readwrite transaction. Multiple public calls do not form a business transaction. Failure leaves the previous committed record intact. Callers retain ownership of their input objects; the library does not normalize or mutate them.

## Query contract

```ts
await db.list('tasks', {
  filter: {
    status: { $in: ['todo', 'doing'] },
    $or: [
      { title: { $contains: 'React' } },
      { title: { $contains: 'Browser' } },
    ],
  },
  sort: { title: 1 },
  limit: 20,
  offset: 0,
})
```

Comparison and logical operators borrow [Feathers query conventions](https://feathersjs.com/api/databases/querying). The function API, separate `filter` and `sort`, `offset`, and `$contains` are Gamma conventions; this package does not claim complete Feathers compatibility.

| Filter | Meaning |
| --- | --- |
| `{ field: scalar }` | Strict equality |
| `{ field: { $ne: scalar } }` | Not equal, for a present field of the declared type |
| `$in` / `$nin` | Membership / non-membership in a scalar array |
| `$gt` / `$gte` / `$lt` / `$lte` | String or numeric comparison, with operands matching the field type |
| `$contains` | Case-sensitive literal substring in a string field |
| `$and: [filters]` / `$or: [filters]` | All / any nested filter conditions |

Different field entries and multiple operators on one field combine with AND. Empty `filter` and `$and: []` match everything; `$or: []` matches nothing. Empty `$in` matches nothing; empty `$nin` matches present, correctly typed scalar fields. Field conditions cannot be empty operator objects.

Filters only address declared top-level scalar fields, not object or array equality, array elements, dot paths, or other resources. Operators check operand types, not business values such as membership in a model enum. Missing fields never satisfy field conditions, including `$ne` and `$nin`. Explicit null is distinct from missing and is accepted as an operand only for nullable fields. Legacy values of an incompatible type do not match current typed conditions. No `search`, projection, aggregation, regex, or relation expansion is available.

Sorting accepts declared string or numeric fields with direction `1` or `-1`, in JavaScript property enumeration order. Strings use JavaScript lexicographic comparison without locale-dependent collation; numbers use numeric comparison. Missing, null and legacy non-comparable values sort after comparable values for either direction. Subsequent sort fields break ties, followed by ascending string `id`. Omitted or empty sort defaults to ascending `id`.

`limit` defaults to 20 and must be a safe integer from 0 through 1000. `offset` defaults to 0 and must be a nonnegative safe integer. Out-of-range values fail rather than clamp. `total` counts all matched records before pagination. `limit: 0` returns the count with empty `data`; an offset beyond the result set also returns empty `data` without changing the count.

For a direct top-level string/numeric equality condition covering every field of a declared index, the first matching declared index supplies candidate records. Other queries scan the resource. Predicates, ordering and pagination are then applied in memory. The same query has identical semantics with and without an index; this is not an arbitrary query optimizer or a large-dataset streaming API.

## Model changes and lifecycle

The physical name is `gamma-compose:local-db:` followed by `databaseName`. Each resource has an object store keyed by `id`. Reopening the same name on the same browser origin retains data. Different names or origins use different databases. This namespace is not authorization: other code on the origin can access IndexedDB.

Opening adds missing stores and indexes using an IndexedDB version upgrade. It does not remove omitted stores, old indexes or data. Omitted resources are inaccessible through the current instance but become accessible when declared again. Changed definitions apply only after closing and reopening. An upgrade closes other library-managed connections through `versionchange`; operations on those instances subsequently fail with `DATABASE_CLOSED`. A blocking external connection causes `STORAGE_BLOCKED`; that abandoned request must not apply its upgrade later. There is no retry loop.

The native database version tracks physical layout only. `protocolVersion` tracks the declaration format only. Neither skips record validation. There is no record version or migration history.

`get/list` return historical records without validating or changing them. `create/update` always validate complete records against the current schema. For example, adding a required `category` allows an old record to be read, but updating only its title fails until the caller also supplies `category`. Removing a top-level field from the model leaves old records unchanged until each record is successfully updated, at which point its obsolete top-level fields are dropped. Submitting those removed fields again is an input error, not a request to silently discard them. The ID and all untouched declared fields are preserved. Validation failure or an aborted write preserves the entire old record, including obsolete fields. Nested objects must be repaired by submitting a full replacement; they are not recursively projected. Repair code uses normal reads and updates; no validation bypass or background rewrite is provided. Deleting a record does not validate its shape or affect any other record.

`close()` releases the connection without deleting the database. Storage eviction, private browsing restrictions and clearing site data remain browser concerns; local persistence is not a backup guarantee.

## Errors and browser execution

`LocalDbError` extends Error and exposes `code`, an English `message`, optional `{ path, message }[]` validation `details`, and an optional underlying `cause`. Paths in validation details use JSON Pointer; a required-field error identifies its missing field in the message. Applications should branch on codes, not human-readable wording. Validation errors do not include whole business records.

| Code | Meaning |
| --- | --- |
| `INVALID_MODEL` | Invalid options, resource/schema definition or failed schema compilation |
| `UNKNOWN_RESOURCE` | Resource not declared in this instance |
| `INVALID_QUERY` | Unsupported query shape, field, operator or operand |
| `VALIDATION_FAILED` | Invalid write data, managed ID supplied, invalid ID argument or complete-record validation failure |
| `NOT_FOUND` | Update target does not exist |
| `DATABASE_CLOSED` | Explicitly closed or invalidated connection |
| `STORAGE_UNAVAILABLE` | IndexedDB absent or access disallowed |
| `STORAGE_BLOCKED` | Another connection prevented the required upgrade |
| `STORAGE_ERROR` | Other IndexedDB failure, including aborted writes and quota errors; inspect cause |

The runtime requires IndexedDB and secure-context UUID generation. Ajv's browser runtime compilation requires CSP `script-src` to allow `'unsafe-eval'`; see [Ajv security guidance](https://ajv.js.org/security.html). The package does not relax CSP or fetch external schemas. Strict-CSP precompiled validators are out of scope. Models are application configuration, not executable JavaScript, but model compilation still consumes browser CPU and memory; the library is not a sandbox for arbitrarily large hostile inputs.

Iteration 1 excludes preview bridge integration, automatic resource-file discovery, Agent skills/tools and React bindings. The host application imports model files and calls `openLocalDb` explicitly.
