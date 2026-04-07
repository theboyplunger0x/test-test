#!/bin/bash
cd ~/Desktop/Proyectos/FUDmarkets/backend && railway service link "test-test" 2>/dev/null; railway logs --filter "genlayer OR resolver"
