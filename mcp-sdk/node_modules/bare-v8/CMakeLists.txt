cmake_minimum_required(VERSION 3.25)

find_package(cmake-bare REQUIRED PATHS node_modules/cmake-bare)

project(bare_v8 C)

add_bare_module(bare_v8)

target_sources(
  ${bare_v8}
  PRIVATE
    binding.c
)
