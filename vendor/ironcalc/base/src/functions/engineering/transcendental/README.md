# Creating tests from transcendental functions

Excel supports a number of transcendental functions like the error functions, gamma nad beta functions.
In this folder we have tests for the Bessel functions.
Some other platform's implementations of those functions are remarkably poor (including Excel), sometimes failing on the third decimal digit. We strive to do better.

To properly test you need to compute some known values with established arbitrary precision arithmetic.

I use for this purpose Arb[1], created by the unrivalled Fredrik Johansson[2]. You might find some python bindings, but I use Julia's Nemo[3]:

```julia
julia> using Nemo
julia> CC = AcbField(200)
julia> besseli(CC("17"), CC("5.6"))
```

If you are new to Julia, just install Julia and in the Julia terminal run:

```
julia> using Pkg; Pkg.add("Nemo")
```

You only need to do that once (like the R philosophy)

Will give you any Bessel function of any order (integer or not) of any value real or complex

[1]: https://arblib.org/
[2]: https://fredrikj.net/
[3]: https://nemocas.github.io/Nemo.jl/latest/