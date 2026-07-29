cmake_minimum_required(VERSION 3.21)
project(crossgram_e2e_native_smoke LANGUAGES CXX)

if(NOT DEFINED E2E_SOURCE_ROOT)
  message(FATAL_ERROR "Pass -DE2E_SOURCE_ROOT=<patched Telegram/SourceFiles>")
endif()

find_package(Qt6 6.8 REQUIRED COMPONENTS Core Gui Network Widgets)

add_library(crossgram_e2e_native_smoke STATIC
  "${E2E_SOURCE_ROOT}/crossgram/e2e.cpp"
  "${E2E_SOURCE_ROOT}/crossgram/e2e.h"
)
target_compile_features(crossgram_e2e_native_smoke PRIVATE cxx_std_20)
target_include_directories(crossgram_e2e_native_smoke PUBLIC "${E2E_SOURCE_ROOT}")
target_link_libraries(crossgram_e2e_native_smoke PRIVATE
  Qt6::Core
  Qt6::Gui
  Qt6::Network
  Qt6::Widgets
)

add_executable(crossgram_e2e_native_harness main.cpp)
target_compile_features(crossgram_e2e_native_harness PRIVATE cxx_std_20)
target_link_libraries(crossgram_e2e_native_harness PRIVATE
  crossgram_e2e_native_smoke
  Qt6::Core
  Qt6::Gui
  Qt6::Network
  Qt6::Widgets
)

if(MSVC)
  target_compile_options(crossgram_e2e_native_smoke PRIVATE
    "/FI${CMAKE_CURRENT_SOURCE_DIR}/q_literal_shim.h"
  )
else()
  target_compile_options(crossgram_e2e_native_smoke PRIVATE
    "-include" "${CMAKE_CURRENT_SOURCE_DIR}/q_literal_shim.h"
  )
endif()
